/** Kal Kings: independently testable quantitative entry/exit risk decisions.
 * No network requests or order submission. Actual positions, cash and books
 * must be supplied by authenticated exchange adapters.
 */
import {riskPolicy,adaptiveCapitalLimit} from './strategy.mjs';
import {normalizeKalshiBook,optimizePairedDepth,evaluateRiskAdjustedEntry,portfolioExposureGate,
  snapshotBacktest,executionFillCalibration} from './quant.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const safeAge=(timestamp,now)=>now-Date.parse(timestamp||'');
const rejected=(reason,other={})=>({accepted:false,reason,...other});
export function historyForExit(history,now=Date.now()){
 if(!Array.isArray(history)||!finite(now))return [];
 return history.filter(x=>{
  const when=Date.parse(x?.observedAt||'');
  return finite(when)&&when<=now&&when>=now-7*86400000&&
   finite(Number(x?.bid))&&Number(x.bid)>0&&Number(x.bid)<1;
 }).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)).slice(-240);
}
export function assessLiveKalshiEntry({quote,bookResponse,bankroll,holdings=[],positionsComplete=false,
 history=[],executions=[],now=Date.now(),trials=1500,seed=17}={}){
 if(!positionsComplete||!Array.isArray(holdings))return rejected('INCOMPLETE_HOLDINGS');
 if(!finite(Number(bankroll))||Number(bankroll)<=0)return rejected('UNFUNDED');
 if(!quote||!/^[A-Z0-9_-]{4,128}$/.test(quote.id||'')||
   !finite(safeAge(quote.observedAt,now))||safeAge(quote.observedAt,now)<0||safeAge(quote.observedAt,now)>3000)
  return rejected('STALE_OR_INVALID_QUOTE');
 const accountCash=Number(bankroll),policy=riskPolicy(accountCash);
 let book;
 try{book=normalizeKalshiBook(bookResponse)}catch{return rejected('INVALID_ORDERBOOK');}
 const bestYes=book.yesAsks?.[0]?.price,bestNo=book.noAsks?.[0]?.price;
 if(!finite(bestYes)||!finite(bestNo))return rejected('INSUFFICIENT_DEPTH');
 const minCost=bestYes+bestNo;
 if(minCost>accountCash+1e-7)return rejected('NO_AFFORDABLE_CONTRACT');
 const allocation=adaptiveCapitalLimit(policy,minCost);
 const candidate=optimizePairedDepth({ticker:quote.id,book,balance:accountCash,
   maxCapital:allocation.budget,maxContracts:50,minimumNet:.01,
   slippagePerContract:.002});
 if(!candidate)return rejected('NO_POSITIVE_SPREAD');
 const correlated=portfolioExposureGate({cashAvailable:accountCash,
   maxRiskDollars:allocation.budget,maxTotalGrossExposure:Math.max(allocation.budget,accountCash*3),
   orphanLossDollars:candidate.orphanLossDollars,eventKey:quote.id,holdings});
 const calibration=executionFillCalibration(executions);
 const backtest=snapshotBacktest(historyForExit(history,now));
 if(!correlated.accepted)return rejected(correlated.reason,{candidate,calibration,backtest,risk:correlated});
 const risk=evaluateRiskAdjustedEntry({candidate,freeCash:accountCash,
   riskBudget:allocation.budget,holdings,eventKey:quote.id,history:historyForExit(history,now),
   fills:executions,trials,seed});
 const mc=risk.monteCarlo||null;
 if(!risk.accepted)return rejected(risk.reason,{candidate,calibration,backtest,risk:risk.risk,model:mc});
 // A Monte Carlo run excluding all no-fill cases is not an actual execution
 // forecast. Uncalibrated fill rates remain explicitly labeled provisional.
 if(mc.lossFrequency==null||mc.lossFrequency>.10)
   return rejected('EXCESSIVE_MODELED_LOSS_FREQUENCY',{candidate,calibration,backtest,model:mc,risk:risk.risk});
 return {accepted:true,reason:'EXECUTABLE_QUOTE_RISK_APPROVED',candidate,calibration,backtest,
   model:mc,risk:risk.risk,policy,allocation,
   confidence:calibration.status==='CALIBRATED'?'EXECUTION_CALIBRATED':'PROVISIONAL_UNCALIBRATED',
   note:'Model simulations condition on fills; price, liquidity and fills must be rechecked before every real order.'};
}
export function summarizeQuantState({historySamples=0,executionSamples=0,decisions=[]}={}){
 const h=Math.max(0,Number(historySamples)||0),e=Math.max(0,Number(executionSamples)||0);
 return {confidence:e>=20&&h>=20?'REQUIRES_OUT_OF_SAMPLE_REVIEW':'UNCALIBRATED',
   historicalQuoteCount:h,observedExecutionCount:e,
   testedOpportunities:Array.isArray(decisions)?decisions.length:0,
   verifiedExpectedProfit:null,
   note:'Samples and Monte Carlo assumptions alone do not establish real-world predictive accuracy.'};
}
