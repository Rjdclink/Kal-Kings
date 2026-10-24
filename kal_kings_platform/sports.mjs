/** Sports radar: reviewed event IDs are mandatory for cross-venue comparisons.
 * The normalized DraftKings market probability is NOT an independent predictive model.
 */
import {impliedTwoWay, recommendedDirectional, simulateDirectional, riskPolicy} from './strategy.mjs';
import {quoteAge,validPrice} from './engine.mjs';
const cents=n=>Math.round(n*100)/100;
const REFRESH_MAX_MS=90_000,REVIEW_LIFETIME_MS=7*86400000;
export function favoriteWatchlist(draftKingsEvents,now=Date.now()){
  if(!Array.isArray(draftKingsEvents))return [];
  return draftKingsEvents.flatMap(event=>{
    if(quoteAge(event,now)>REFRESH_MAX_MS||event.outcomes?.length!==2)return [];
    const sorted=event.outcomes.map(offer=>({...offer,p:impliedTwoWay(event.outcomes,offer.selection)}))
      .filter(offer=>offer.p!==null).sort((a,b)=>b.p-a.p);
    if(!sorted.length||sorted[0].p<.75)return [];
    return [{eventId:event.id,event:event.event,selection:sorted[0].selection,odds:sorted[0].american,
      marketImpliedConfidence:cents(sorted[0].p*100),source:'DraftKings implied (de-vig)',
      profitable:false,expectedProfit:null,reviewRequired:true,updatedAt:event.updatedAt||null,
      note:'High confidence is not evidence of positive expected return. Compare executable prices and independent forecasts.'}];
  }).sort((a,b)=>b.marketImpliedConfidence-a.marketImpliedConfidence).slice(0,10);
}
export function directionalCandidates(pairs,kalshi,draft,availableBalance,now=Date.now()){
  if(!Array.isArray(pairs)||!Array.isArray(kalshi)||!Array.isArray(draft)||!Number.isFinite(Number(availableBalance))||availableBalance<=0)return [];
  const signals=[];
  for(const pair of pairs){
    const reviewed=Date.parse(pair.reviewed_at||'');
    if(!Number.isFinite(reviewed)||reviewed>now||now-reviewed>REVIEW_LIFETIME_MS||!/^sha256:[0-9a-f]{64}$/.test(String(pair.reviewed_rule_digest||'')))continue;
    const km=kalshi.find(m=>m.id===pair.kalshi_ticker),de=draft.find(d=>d.id===pair.dk_event_id);
    if(!km||!de||quoteAge(km,now)>10_000||quoteAge(de,now)>REFRESH_MAX_MS||de.outcomes?.length!==2)continue;
    const oppProb=impliedTwoWay(de.outcomes,pair.dk_selection);
    if(oppProb===null)continue;
    const ask=km[pair.kalshi_side==='no'?'noAsk':'yesAsk'];
    const depth=km[pair.kalshi_side==='no'?'noDepth':'yesDepth'];
    if(!validPrice(ask))continue;
    const probability=1-oppProb;
    const advice=recommendedDirectional({bankroll:Number(availableBalance),price:ask,probability,depth,sourceAgeMs:quoteAge(km,now)});
    if(!advice.accepted)continue;
    const mc=simulateDirectional({contracts:advice.contracts,price:ask,probability,fillProbability:.9,
      feePerContract:advice.maximumLossDollars/advice.contracts-ask,trials:4000,seed:8351});
    const ageReview=now-reviewed;
    signals.push({id:pair.id,event:de.event,kalshiTicker:km.id,side:pair.kalshi_side,
      source:'DraftKings market-implied reference, not independent win forecast',
      mode:'MODEL_REFERENCE_ONLY',modelProbability:probability,marketConfidencePct:cents(probability*100),
      marketPrice:ask,marketOdds:de.outcomes.map(o=>({selection:o.selection,odds:o.american})),
      stakeDollars:advice.stakeDollars,contracts:advice.contracts,expectedProfitDollars:advice.expectedNetProfitDollars,
      edgePercentagePoints:advice.edgePercentagePoints,maximumLossDollars:advice.maximumLossDollars,
      lossFrequency:mc.lossFrequency,meanWorst5Percent:mc.meanWorst5Percent,
      riskPolicy:advice.policy,simulations:mc.executedTrials,
      eligibleForAutomation:false, // consensus market price alone is not a validated independent forecast
      reviewAgeHours:Math.round(ageReview/3600000),
      note:'Reference-price discrepancy, not independently established betting value. Autoexecution requires a validated forecast.'});
  }
  return signals.sort((a,b)=>b.expectedProfitDollars-a.expectedProfitDollars).slice(0,10);
}
