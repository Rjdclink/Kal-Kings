/** Kal Kings — quantitative validation, order-book pricing and portfolio limits.
 * Exchange-observed data, not generative predictions. No function places orders.
 * Histories and simulations report their provenance and sample counts.
 */
import {estimatedKalshiFee, seeded} from './engine.mjs';
const validNumber=x=>typeof x==='number'&&Number.isFinite(x);
const num=x=>(x===null||x===undefined||String(x).trim()==='')?NaN:Number(x);
const price=x=>validNumber(x)&&x>0&&x<1;
const r4=x=>Math.round((x+Number.EPSILON)*10000)/10000;
const r6=x=>Math.round((x+Number.EPSILON)*1000000)/1000000;
const avg=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const tailMean=(sorted,fraction=.05)=>avg(sorted.slice(0,Math.max(1,Math.ceil(sorted.length*fraction))));
const score=x=>Math.max(0,Math.min(1,x));
const pointAge=(x)=>Date.parse(x?.observedAt??x?.observed_at??'');

function normalizedLevels(raw){
 // A valid book can have bids on just one side; that opposite array may be null.
 if(raw==null)return [];
 if(!Array.isArray(raw))throw RangeError('Missing exchange depth');
 const levels=[];
 for(const entry of raw){
  if(!Array.isArray(entry)||entry.length!==2)throw RangeError('Unrecognized orderbook level');
  const p=num(entry[0]),q=num(entry[1]);
  if(!price(p)||!validNumber(q)||q<=0||q>1e9)throw RangeError('Invalid displayed book quote');
  levels.push({price:r4(p),quantity:q});
 }
 return levels;
}
export function normalizeKalshiBook(payload){
 const fp=payload?.orderbook_fp;
 if(!fp||fp.yes_dollars==null&&fp.no_dollars==null)throw RangeError('Kalshi fixed-point book missing');
 const yes=normalizedLevels(fp.yes_dollars).sort((a,b)=>b.price-a.price);
 const no=normalizedLevels(fp.no_dollars).sort((a,b)=>b.price-a.price);
 // Kalshi only displays bids: the NO bid at p implies an executable YES ask at 1-p.
 return {yesBids:yes,noBids:no,
  yesAsks:no.map(level=>({price:r4(1-level.price),quantity:level.quantity})),
  noAsks:yes.map(level=>({price:r4(1-level.price),quantity:level.quantity}))};
}
export function sweepAsks(askLevels,quantity){
 if(!Number.isInteger(quantity)||quantity<1||!Array.isArray(askLevels))return null;
 let left=quantity,cost=0,highest=0;
 for(const item of askLevels){
  const p=num(item?.price),q=num(item?.quantity);
  if(!price(p)||!validNumber(q)||q<=0)return null;
  if(left<=0)break;
  const take=Math.min(left,q);cost+=take*p;highest=Math.max(highest,p);left-=take;
 }
 if(left>1e-6)return null;
 return {cost:r6(cost),avgPrice:r6(cost/quantity),worstPrice:r4(highest),quantity};
}
/** Fully funded, conservative limit prices for two separate FOK legs. Not atomic. */
export function optimizePairedDepth({ticker,book,balance,maxCapital,maxContracts=50,minimumNet=0,slippagePerContract=.002}={}){
 const money=num(balance),budget=num(maxCapital);
 if(!/^[A-Z0-9_-]{4,128}$/.test(ticker||'')||!validNumber(money)||money<=0||!validNumber(budget)||budget<=0||!book||!validNumber(slippagePerContract)||slippagePerContract<0)return null;
 const depthY=book.yesAsks?.reduce((s,x)=>s+x.quantity,0)||0;
 const depthN=book.noAsks?.reduce((s,x)=>s+x.quantity,0)||0;
 const nmax=Math.min(100,Math.max(0,Math.trunc(maxContracts)),Math.floor(depthY),Math.floor(depthN));
 let best=null;
 for(let n=1;n<=nmax;n++){
  const yes=sweepAsks(book.yesAsks,n),no=sweepAsks(book.noAsks,n);
  if(!yes||!no)break;
  // Price limits must cover the deepest required level, even if a sweep would
  // usually receive price improvement. Fees are rounded per order.
  // A limit order can receive a better price, where p(1-p) and the
  // resulting taker fee can be HIGHER than at the limit. Bound the fee over
  // the full executable interval, including the 50c maximum where relevant.
  const worstFeePrice=(asks,limit)=>Math.max(asks[0].price,Math.min(.5,limit));
  const yesFee=estimatedKalshiFee(n,worstFeePrice(book.yesAsks,yes.worstPrice));
  const noFee=estimatedKalshiFee(n,worstFeePrice(book.noAsks,no.worstPrice));
  const yesCost=r6(n*yes.worstPrice+yesFee),noCost=r6(n*no.worstPrice+noFee);
  const slippageReserve=2*n*slippagePerContract;
  const required=r6(yesCost+noCost+slippageReserve),net=r6(n-required);
  const orphanLoss=r6(Math.max(yesCost,noCost));
  if(required>money+1e-7||required>budget+1e-7)continue;
  if(net<=minimumNet+1e-9)continue;
  const cand={id:`kalshi:${ticker}`,marketTicker:ticker,source:'KALSHI_ONLY',strategy:'YES_NO_COMPLEMENT',
   count:n,yesPrice:yes.worstPrice,noPrice:no.worstPrice,yesCost,noCost,yesFee,noFee,
   requiredDollars:r4(required),estimatedFeesDollars:r4(yesFee+noFee),netProfitDollars:r4(net),
   orphanLossDollars:r4(orphanLoss),yesVwap:yes.avgPrice,noVwap:no.avgPrice,
   priceBasis:'EXECUTABLE_ORDERBOOK_DEPTH',slippageReserveDollars:r4(slippageReserve)};
  if(!best||cand.netProfitDollars>best.netProfitDollars)best=cand;
 }
 return best;
}
function eventOf(ticker){
 const s=String(ticker??'').trim().toUpperCase();
 const idx=s.lastIndexOf('-');
 return idx>0?s.slice(0,idx):s;
}
/** Worst-case gross event exposure; unrelated positions retain their own buckets. */
export function portfolioExposureGate({cashAvailable,maxRiskDollars,maxTotalGrossExposure=Infinity,orphanLossDollars,eventKey,holdings=[]}={}){
 const cash=num(cashAvailable),limit=num(maxRiskDollars),orphan=num(orphanLossDollars);
 if(!validNumber(cash)||cash<0||!validNumber(limit)||limit<=0||!validNumber(orphan)||orphan<=0||!eventKey||!Array.isArray(holdings))return {accepted:false,reason:'UNKNOWN_PORTFOLIO_RISK'};
 if((maxTotalGrossExposure!==Infinity && (!validNumber(maxTotalGrossExposure)||maxTotalGrossExposure<0)))return {accepted:false,reason:'INVALID_PORTFOLIO_LIMIT'};
 const key=String(eventKey).trim().toUpperCase();
 const bucket=key.split('-').length>=3?eventOf(key):key;
 let correlation=0,total=0;
 for(const row of holdings){
  const units=num(row?.position),name=row?.ticker;
  if(!validNumber(units)||!name)return {accepted:false,reason:'UNVERIFIED_EXISTING_HOLDINGS'};
  const exposure=Math.abs(units);if(exposure===0)continue;
  // Without the actual entry cost, one dollar per contract is the safe gross-loss bound.
  total+=exposure;
  if(eventOf(name)===bucket||String(name).toUpperCase()===bucket)correlation+=exposure;
 }
 if(orphan>cash+1e-8)return {accepted:false,reason:'INSUFFICIENT_CASH'};
 if(total+orphan>maxTotalGrossExposure+1e-8)return {accepted:false,reason:'PORTFOLIO_GROSS_EXPOSURE',totalGrossExposure:r4(total)};
 if(correlation+orphan>limit+1e-8)return {accepted:false,reason:'CORRELATED_EVENT_EXPOSURE',correlatedExposure:r4(correlation),totalGrossExposure:r4(total)};
 return {accepted:true,reason:'WITHIN_PORTFOLIO_LIMITS',correlatedExposure:r4(correlation),totalGrossExposure:r4(total),
  potentialCorrelatedLoss:r4(correlation+orphan),riskLimitDollars:r4(limit)};
}
/** Count only exchange-confirmed execution outcomes. Unknown receipts are excluded. */
export function executionFillCalibration(rows,{minSamples=20}={}){
 const valid=(Array.isArray(rows)?rows:[]).filter(x=>{
  const n=num(x.count),a=num(x.yes_filled),b=num(x.no_filled);
  return validNumber(n)&&n>0&&validNumber(a)&&validNumber(b)&&a>=0&&b>=0&&a<=n&&b<=n&&['HEDGED','UNHEDGED','NOT_FILLED','PARTIALLY_FILLED'].includes(x.status);
 });
 const count=valid.length, first=valid.filter(x=>num(x.yes_filled)>0).length;
 const both=valid.filter(x=>num(x.yes_filled)>0&&num(x.no_filled)>0).length;
 if(count<minSamples||first<minSamples/3)return {status:'INSUFFICIENT_EXECUTIONS',sampleCount:count,firstFillRate:null,secondFillRate:null};
 return {status:'CALIBRATED',sampleCount:count,firstFillRate:r4((first+2)/(count+4)),
  secondFillRate:r4((both+2)/(first+4)),source:'CONFIRMED_ORDER_RECEIPTS_WITH_BETA_SMOOTHING'};
}
/** P&L conditional on at least one leg filling. Model for non-atomic sequential bids.
 * Execution probabilities must be calibrated separately; no-fill is not a win.
 */
export function simulateSequentialFills({count,yesPrice,noPrice,yesFee=0,noFee=0,yesFillProbability=.75,noFillProbability=.7,yesWinProbability,slippage=.002,trials=2000,seed=17}={}){
 if(!Number.isInteger(count)||count<1||!price(yesPrice)||!price(noPrice)||yesPrice+noPrice>=1||
    !validNumber(yesFee)||yesFee<0||!validNumber(noFee)||noFee<0||
    ![yesFillProbability,noFillProbability].every(x=>validNumber(x)&&x>=0&&x<=1)||
    !Number.isInteger(trials)||trials<100||trials>100000||!validNumber(slippage)||slippage<0)throw RangeError('Invalid Monte Carlo inputs');
 const implied=yesPrice/(yesPrice+noPrice);
 const win=yesWinProbability==null?implied:num(yesWinProbability);
 if(!validNumber(win)||win<0||win>1)throw RangeError('Invalid outcome probability');
 const rng=seeded(seed),pnl=[];let noFills=0,hedged=0,unhedged=0;
 for(let i=0;i<trials;i++){
  if(rng()>=yesFillProbability){noFills++;continue;}
  const yesCost=count*yesPrice+yesFee+count*rng()*slippage;
  if(rng()<noFillProbability){
   const cost=yesCost+count*noPrice+noFee+count*rng()*slippage;
   pnl.push(count-cost);hedged++;
  }else{
   // Unhedged YES is held to a sampled settlement, not magically unwound.
   pnl.push((rng()<win?count:0)-yesCost);unhedged++;
  }
 }
 pnl.sort((a,b)=>a-b);
 const n=pnl.length;
 return {mode:'SIMULATION_ONLY',assumptions:'SEQUENTIAL_NON_ATOMIC_FILLS',trials,executedTrials:n,noFillTrials:noFills,
  executionRate:r4(n/trials),fullHedgeRate:n?r4(hedged/n):0,partialOrUnhedgedRate:n?r4(unhedged/n):0,
  meanPnl:n?r4(avg(pnl)):null,meanWorst5Percent:n?r4(tailMean(pnl)):null,
  lossFrequency:n?r4(pnl.filter(x=>x<0).length/n):null,
  worstSamplePnl:n?r4(pnl[0]):null,p05:n?r4(pnl[Math.floor((n-1)*.05)]):null,
  calibrationRequired:true,unhedgedPayoffProbabilitySource:yesWinProbability==null?'IMPLIED_FROM_PRICE_NOT_INDEPENDENT':'EXTERNAL'};
}
/** Strictly chronological train/holdout probability calibration. */
export function walkForwardCalibration(samples,{minTraining=30,minTest=10,trainingFraction=.7}={}){
 const clean=(Array.isArray(samples)?samples:[]).filter(x=>{
  const p=num(x?.predicted),y=x?.outcome;
  return validNumber(pointAge(x))&&price(p)&&(y===0||y===1)&&(!x.settledAt||Date.parse(x.settledAt)>=pointAge(x));
 }).sort((a,b)=>pointAge(a)-pointAge(b));
 const n=clean.length,cut=Math.floor(n*trainingFraction);
 if(cut<minTraining||n-cut<minTest)return {status:'INSUFFICIENT_HISTORY',sampleCount:n,trainingCount:0,holdoutCount:0};
 const test=clean.slice(cut),testStart=pointAge(test[0]);
 // Training outcomes must have settled before the first holdout prediction.
 // Unknown settlement timestamps are tolerated for research fixtures only;
 // production calibration input requires independently verified settlements.
 const train=clean.slice(0,cut).filter(row=>!row.settledAt||Date.parse(row.settledAt)<=testStart);
 if(train.length<minTraining)return {status:'INSUFFICIENT_HISTORY',sampleCount:n,trainingCount:train.length,holdoutCount:test.length,reason:'SETTLEMENT_LABELS_NOT_AVAILABLE_AT_TRAIN_TIME'};
 // Calibration mapping is locked after the training split. Beta prior shrinks
 // sparse probability buckets; the holdout outcomes never influence fit.
 const buckets=Array.from({length:10},()=>({wins:0,count:0,sumP:0}));
 for(const s of train){let b=Math.min(9,Math.floor(num(s.predicted)*10)); buckets[b].wins+=s.outcome;buckets[b].count++;buckets[b].sumP+=num(s.predicted);}
 const smooth=p=>{const b=buckets[Math.min(9,Math.floor(p*10))];return (b.wins+8*p)/(b.count+8);};
 const brier=(records,f)=>r6(avg(records.map(row=>(f(num(row.predicted))-row.outcome)**2)));
 const baseline=brier(test,p=>p),calibrated=brier(test,smooth);
 return {status:'VALIDATED_HOLDOUT',sampleCount:n,trainingCount:train.length,holdoutCount:test.length,
  holdoutBrier:baseline,calibratedBrier:calibrated,
  improvesHoldout:calibrated<baseline,calibrationMethod:'TEN_BIN_BETA_SHRINKAGE_TIME_SPLIT',
  note:'A held-out Brier score measures historical forecast calibration, not future guaranteed profit.'};
}
/** Snapshot replay buys at the recorded ask and sells at the NEXT recorded bid.
 * This cannot assert a historical order actually filled, but it avoids using
 * the future to choose an entry point.
 */
export function snapshotBacktest(observations,{entryFee=.005,exitFee=.005,minRecords=20}={}){
 const rows=(Array.isArray(observations)?observations:[]).filter(x=>validNumber(pointAge(x))&&price(num(x.ask))&&price(num(x.bid)))
  .sort((a,b)=>pointAge(a)-pointAge(b));
 if(rows.length<minRecords)return {status:'INSUFFICIENT_HISTORY',observations:rows.length,trades:0};
 const trades=[];
 for(let i=0;i<rows.length-1;i++){
  if(pointAge(rows[i+1])<=pointAge(rows[i]))continue;
  trades.push(r6(num(rows[i+1].bid)-num(rows[i].ask)-entryFee-exitFee));
 }
 const split=Math.floor(trades.length*.7);
 if(split<10||trades.length-split<3)return {status:'INSUFFICIENT_HISTORY',observations:rows.length,trades:trades.length};
 const holdout=trades.slice(split);
 return {status:'BACKTESTED',trades:trades.length,trainingTrades:split,holdoutTrades:holdout.length,
  trainingMeanPnl:r6(avg(trades.slice(0,split))),holdoutMeanPnl:r6(avg(holdout)),
  holdoutLossFrequency:r4(holdout.filter(x=>x<0).length/holdout.length),
  holdoutMeanWorst5Percent:r6(tailMean([...holdout].sort((a,b)=>a-b))),
  method:'ONE_STEP_FORWARD_ASK_TO_BID_WITH_COSTS',
  note:'Hypothetical quotes, not evidence of fillability; historical windows are not predictive guarantees.'};
}
/** Empirical increment-bootstrap exit-versus-hold stress model. */
export function monteCarloExitDecision({entryPrice,currentBid,quantity=1,observations=[],entryFee=0,exitFee=0,trials=1200,horizon=4,seed=31,tailLimitDollars=Infinity}={}){
 const rows=(Array.isArray(observations)?observations:[]).filter(x=>validNumber(pointAge(x))&&price(num(x.bid)))
  .sort((a,b)=>pointAge(a)-pointAge(b));
 const increments=[];
 for(let i=1;i<rows.length;i++){
  const earlier=num(rows[i-1].bid),later=num(rows[i].bid);
  if(pointAge(rows[i])>pointAge(rows[i-1])&&earlier>0)increments.push(later/earlier-1);
 }
 if(increments.length<12)return {status:'INSUFFICIENT_HISTORY',action:'UNKNOWN',observations:rows.length};
 if(!price(entryPrice)||!price(currentBid)||!Number.isInteger(quantity)||quantity<1||!Number.isInteger(trials)||trials<100||trials>100000||!Number.isInteger(horizon)||horizon<1||horizon>30)return {status:'INVALID_INPUT',action:'UNKNOWN'};
 const random=seeded(seed),results=[];
 for(let i=0;i<trials;i++){
  let bid=currentBid;
  for(let step=0;step<horizon;step++){
   const movement=increments[Math.floor(random()*increments.length)];
   bid=Math.max(.0001,Math.min(.9999,bid*(1+movement)));
  }
  results.push((bid-entryPrice)*quantity-entryFee-exitFee);
 }
 results.sort((a,b)=>a-b);
 const exitNow=(currentBid-entryPrice)*quantity-entryFee-exitFee;
 const projectedHold=avg(results),worst5=tailMean(results);
 const advantage=exitNow-projectedHold;
 const shouldExit=advantage>.005||(Number.isFinite(tailLimitDollars)&&worst5<-tailLimitDollars);
 return {status:'MODELED',action:shouldExit?'SELL':'HOLD',observationChanges:increments.length,
  trials,projectedHoldPnl:r4(projectedHold),immediateExitPnl:r4(exitNow),
  projectedWorst5Pnl:r4(worst5),exitAdvantageDollars:r4(advantage),
  assumptionSource:'HISTORICAL_OBSERVED_BID_CHANGES',
  note:'Historical bootstrap does not identify a future price peak; an exit bid may not fill.'};
}
/** Entry gate combines depth pricing, realized portfolio holdings and Monte Carlo. */
export function evaluateRiskAdjustedEntry({candidate,freeCash,riskBudget,holdings=[],eventKey,history=[],fills=[],trials=1500,seed=17}={}){
 const no=(reason,extra={})=>({accepted:false,reason,...extra});
 if(!candidate||!validNumber(num(freeCash))||num(freeCash)<candidate.requiredDollars)return no('INSUFFICIENT_CASH');
 const calibration=executionFillCalibration(fills);
 const risk=portfolioExposureGate({cashAvailable:freeCash,maxRiskDollars:riskBudget,
  orphanLossDollars:candidate.orphanLossDollars,eventKey:eventKey||candidate.marketTicker,holdings});
 if(!risk.accepted)return no(risk.reason,{risk,calibration});
 const mc=simulateSequentialFills({count:candidate.count,yesPrice:candidate.yesPrice,noPrice:candidate.noPrice,
  yesFee:candidate.yesFee??0,noFee:candidate.noFee??0,
  yesFillProbability:calibration.status==='CALIBRATED'?calibration.firstFillRate:.75,
  noFillProbability:calibration.status==='CALIBRATED'?calibration.secondFillRate:.70,
  trials,seed});
 if(mc.executedTrials===0)return no('NO_EXECUTIONS_SIMULATED',{monteCarlo:mc,calibration,risk});
 if(mc.meanWorst5Percent < -riskBudget-1e-7)return no('MONTE_CARLO_TAIL_EXCEEDS_BUDGET',{monteCarlo:mc,calibration,risk});
 if(mc.meanPnl<=1e-9)return no('NO_POSITIVE_RISK_ADJUSTED_EDGE',{monteCarlo:mc,calibration,risk});
 const scenarioBacktest=snapshotBacktest(history);
 // Historical results cannot directly prove the paired spread; they inform
 // the confidence status but do not overwrite the current executable spread.
 return {accepted:true,reason:'RISK_ADJUSTED_ENTRY',candidate,monteCarlo:mc,calibration,
  backtest:scenarioBacktest,risk,expectedNetProfitDollars:mc.meanPnl,
  priceBasis:'ORDERBOOK',limitBeforeSubmission:true};
}
