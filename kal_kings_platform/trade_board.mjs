/** Presentation-only Kal Kings trade board. Nothing in this module submits orders. */
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const money=n=>Math.round(n*100)/100;
export function buildTradeBoard({opportunities=[],signals=[],priceGaps=[],favorites=[]}={}){
 const eligible=opportunities.filter(x=>finite(Number(x.minimumProfit))&&Number(x.minimumProfit)>0
   &&x.id&&x.kalshiTicker&&x.selection&&x.event&&finite(Number(x.dkStake))&&Number(x.dkStake)>0)
  .map(x=>({id:x.id,event:x.event,selection:x.selection,kalshiTicker:x.kalshiTicker,
   side:x.kalshiSide,kalshiPrice:x.kalshiAsk,draftKingsOdds:x.dkAmerican,
   draftKingsStake:Number(x.dkStake),expectedProfit:money(Number(x.minimumProfit)),
   modeledMean:x.monteCarlo?.expectedProfit??null,modeledTail:x.monteCarlo?.meanWorst5Percent??null,
   action:'PREPARE_DRAFTKINGS',executable:false,conditionedOnOpposingFill:true,
   label:'Conditionally profitable',message:'Verify both executable prices and the accepted sportsbook ticket before Kalshi hedging.'}))
  .sort((a,b)=>b.expectedProfit-a.expectedProfit).slice(0,10);
 const review=[...signals.map(x=>({id:x.id,event:x.event,selection:x.side,kalshiTicker:x.kalshiTicker,
  source:'Market comparison',reference:x.marketPrice,reason:'Not independently calibrated',
  action:'REVIEW_ONLY',executable:false,expectedProfit:null,label:'Research only'})),
 ...priceGaps.map(x=>({id:`gap:${x.event}:${x.selection}`,event:x.event,selection:x.selection,
  source:`${x.marketA} ↔ ${x.marketB}`,reference:x.priceGapPercentagePoints,
  reason:'Quote difference; not matched executable profit',action:'REVIEW_ONLY',executable:false,expectedProfit:null,label:'Unverified gap'})),
 ...favorites.map(x=>({id:`favorite:${x.event}:${x.selection}`,event:x.event,selection:x.selection,
  source:'DraftKings',reference:x.marketImpliedConfidence,reason:'High win probability does not establish profitable pricing',
  action:'REVIEW_ONLY',executable:false,expectedProfit:null,label:'Market favorite'}))].slice(0,10);
 return {eligible,review,eligibleCount:eligible.length,reviewCount:review.length,
  note:'No opportunities are invented when verified prices or reviewed settlement matches are missing.'};
}

export function executionSummary(orders=[]){
 const attempted=Array.isArray(orders)?orders:[];
 const executed=attempted.filter(x=>Number(x.filled)>0&&['FILLED','PARTIALLY_FILLED'].includes(x.status));
 return {orderAttempts:attempted.length,executedOrders:executed.length,
   confirmedFilledContracts:money(executed.reduce((sum,x)=>sum+Number(x.filled),0)),
   outstandingUnknown:attempted.filter(x=>x.status==='UNKNOWN'||x.status==='SUBMITTING').length,
   totalProfit:null, note:'Profit requires realized settlement or verified mark-to-market data. Unfilled attempts are not trades.'};
}
export function bankrollTradeStatus({balance,opportunities=[],riskPolicy=null}={}){
 const b=Number(balance),funded=finite(b)&&b>0;
 const cap=riskPolicy?.hardLossLimitDollars;
 let reason='READY_TO_EVALUATE';
 if(!funded)reason='UNFUNDED';
 else if(!opportunities.length)reason='NO_EXECUTABLE_MATCH';
 else if(!finite(cap)||cap<0)reason='RISK_POLICY_UNAVAILABLE';
 return {funded,tradeReady:reason==='READY_TO_EVALUATE',reason,
   description:reason==='RISK_POLICY_UNAVAILABLE'
     ?'The allocation policy is unavailable. No order is qualified.'
     :reason==='NO_EXECUTABLE_MATCH'?'No verified profitable matched opportunity is available now.'
     :reason==='UNFUNDED'?'No available Kalshi funds.':
      'Execution still depends on fresh quotes, price, fees, verified market rules, and confirmed fills.'};
}
