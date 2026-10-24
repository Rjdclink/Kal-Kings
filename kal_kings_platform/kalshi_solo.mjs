/** Kal Kings independent Kalshi-only scanner.
 * Looks for a YES/NO complementary-price discount on ONE binary market.
 * It does not use DraftKings, Polymarket, fuzzy matching, or model-generated forecasts.
 * A positive two-sided quote is conditional, NOT a guaranteed realized profit:
 * the legs can fill separately and the book may move.
 */
import {cash,estimatedKalshiFee,quoteAge,validPrice} from './engine.mjs';
import {riskPolicy,adaptiveCapitalLimit} from './strategy.mjs';

const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function findKalshiSoloCandidates(quotes,{balance,now=Date.now(),maxCandidates=10}={}){
  const free=Number(balance);
  if(!finite(free)||free<=0||!Array.isArray(quotes))return [];
  const policy=riskPolicy(free),out=[];
  for(const quote of quotes){
    const y=Number(quote.yesAsk),n=Number(quote.noAsk);
    const yd=Number(quote.yesDepth),nd=Number(quote.noDepth);
    if(!/^[A-Z0-9_-]{4,128}$/.test(quote.id||'')||!validPrice(y)||!validPrice(n)||!finite(yd)||!finite(nd)||yd<1||nd<1)continue;
    if(quoteAge(quote,now)>3000)continue;
    const firstLotFees=estimatedKalshiFee(1,y)+estimatedKalshiFee(1,n);
    const oneLotCost=y+n+firstLotFees;
    const unitProfit=1-oneLotCost;
    if(unitProfit<=.01+1e-9)continue;
    const allowance=adaptiveCapitalLimit(policy,oneLotCost);
    const maxQuantity=Math.min(Math.floor(yd),Math.floor(nd),Math.floor(free/oneLotCost),Math.floor(allowance.budget/oneLotCost),50);
    if(maxQuantity<1)continue;
    let best=null;
    for(let count=1;count<=maxQuantity;count++){
      const fees=estimatedKalshiFee(count,y)+estimatedKalshiFee(count,n);
      const spent=count*(y+n)+fees;
      const net=count-spent;
      if(spent>free+1e-8||spent>allowance.budget+1e-8||net<=.01+1e-9)continue;
      const orphanLoss=Math.max(count*y+estimatedKalshiFee(count,y),count*n+estimatedKalshiFee(count,n));
      // If the first leg fills alone, its entire cost can be lost. This risk
      // cannot exceed the bankroll or the adaptive capital allowance.
      if(orphanLoss>allowance.budget+1e-8)continue;
      best={id:`kalshi:${quote.id}`,marketTicker:quote.id,event:quote.event||quote.label||quote.id,
        source:'KALSHI_ONLY',strategy:'YES_NO_COMPLEMENT',count,yesPrice:y,noPrice:n,
        requiredDollars:cash(spent),estimatedFeesDollars:cash(fees),netProfitDollars:cash(net),
        orphanLossDollars:cash(orphanLoss),quoteObservedAt:quote.observedAt,
        minimumTradeExceptionApplied:allowance.minimumTradeExceptionApplied,
        note:'Indicative positive two-sided spread; individual fills are not atomic. Trading may remain unhedged.'};
    }
    if(best)out.push(best);
  }
  return out.sort((a,b)=>b.netProfitDollars-a.netProfitDollars||a.marketTicker.localeCompare(b.marketTicker)).slice(0,maxCandidates);
}
export function kalshiSoloLegs(candidate,clientOrderIds){
  if(!candidate||candidate.source!=='KALSHI_ONLY'||!Array.isArray(clientOrderIds)||clientOrderIds.length!==2||clientOrderIds[0]===clientOrderIds[1])throw RangeError('Invalid independent Kalshi order plan');
  if(!Number.isInteger(candidate.count)||candidate.count<1||!validPrice(candidate.yesPrice)||!validPrice(candidate.noPrice)||candidate.yesPrice+candidate.noPrice>=1)throw RangeError('Invalid complementary prices');
  const ids=clientOrderIds;
  if(ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)))throw RangeError('Invalid order identifiers');
  const base={ticker:candidate.marketTicker,count:candidate.count.toFixed(2),time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true};
  return [{...base,side:'bid',price:candidate.yesPrice.toFixed(4),client_order_id:ids[0]},
    {...base,side:'ask',price:(1-candidate.noPrice).toFixed(4),client_order_id:ids[1]}];
}
export function summarizeSoloOrders(orders=[]){
  const rows=Array.isArray(orders)?orders:[];
  return {totalAttempts:rows.length,fullyHedgedTrades:rows.filter(x=>x.status==='HEDGED'&&Number(x.yes_filled)>0&&Number(x.no_filled)>0).length,
    unhedgedPositions:rows.filter(x=>['UNHEDGED','UNCERTAIN'].includes(x.status)).length,
    notFilled:rows.filter(x=>x.status==='NOT_FILLED').length,
    realizedProfitDollars:null,note:'Executed legs and settlements must be reconciled; projected edge is not realized profit.'};
}
