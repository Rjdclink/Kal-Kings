/** Kal Kings: managed Kalshi position and bankroll lifecycle. No market can be
 * timed at an objectively known peak. Decisions use actual bids, current free
 * cash, confirmed exchange holdings and configurable stop/trailing rules.
 * No fills or settlements are invented and no ledger credits are created.
 */
import {validPrice} from './engine.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round((n+Number.EPSILON)*10000)/10000;

export function cashAvailableForReinvestment(exchange,{reserved=0}={}){
  // Latest exchange-reported *free* cash is the sole source of truth. The
  // settlement feed is a confirmation, never a separate balance credit.
  const balance=Number(exchange?.balance),hold=Number(reserved);
  if(!finite(balance)||balance<0||!finite(hold)||hold<0||hold>balance)
    return {available:0,status:'UNAVAILABLE'};
  const available=round(Math.max(0,balance-hold));
  return {available,status:available>0?'AVAILABLE':'UNFUNDED'};
}
export function settlementEvidence(settlements,ticker){
 const s=Array.isArray(settlements)?settlements.find(r=>r.ticker===ticker&&r.settled_time&&['yes','no','void','scalar'].includes(r.market_result)):null;
 return {status:s?'SETTLED':'NOT_CONFIRMED',settledAt:s?.settled_time||null,credited:false};
}
export function assessManagedExit({entryPrice,bidPrice,highestBid=entryPrice,availableDepth=0,quantity=0,quoteAgeMs=Infinity,
 estimatedExitFee=0,stopLossPercent=12,takeProfitPercent=20,trailingPercent=10}={}){
 const unavailable=reason=>({action:'UNAVAILABLE',reason});
 if(!validPrice(Number(entryPrice))||!validPrice(Number(bidPrice))||!validPrice(Number(highestBid))||
    !finite(Number(quantity))||quantity<=0||!finite(Number(estimatedExitFee))||estimatedExitFee<0||
    !finite(Number(quoteAgeMs))||quoteAgeMs<0||quoteAgeMs>3000||
    !finite(Number(availableDepth))||availableDepth<quantity||
    [stopLossPercent,takeProfitPercent,trailingPercent].some(x=>!finite(x)||x<=0||x>=100))return unavailable('STALE_ILLQUID_OR_INVALID');
 const peak=Math.max(Number(bidPrice),Number(highestBid)),bid=Number(bidPrice),entry=Number(entryPrice);
 const proceeds=(bid*quantity)-estimatedExitFee;
 const entryCost=entry*quantity;
 const net=round(proceeds-entryCost),netReturnPct=(proceeds/entryCost-1)*100;
 const peakPct=(peak/entry-1)*100;
 const drawdownPct=(1-bid/peak)*100;
 let reason=null;
 if(netReturnPct<=-stopLossPercent)reason='STOP_LOSS';
 else if(peakPct>=takeProfitPercent&&drawdownPct>=trailingPercent&&net>0)reason='TRAILING_PROFIT_EXIT';
 return {action:reason?'SELL':'HOLD',reason:reason||'NO_EXIT_SIGNAL',netProfitDollars:net,
  netReturnPercent:round(netReturnPct),peakBid:round(peak),drawdownPercent:round(drawdownPct),
  note:'No future price peak can be known; a stop or trailing exit may fail to fill at the quoted bid.'};
}
export function buildReductionOrder({ticker,direction,quantity,bidPrice,clientOrderId}){
 if(!/^[A-Z0-9_-]{4,128}$/.test(ticker||'')||!['yes','no'].includes(direction)||
    !Number.isInteger(quantity)||quantity<1||!validPrice(Number(bidPrice))||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(clientOrderId||''))throw RangeError('Invalid reduction request');
 // V2 book side yes=bid, no=ask (opposite exposure), with YES-scale price.
 return {ticker,client_order_id:clientOrderId,side:direction==='yes'?'ask':'bid',
  count:quantity.toFixed(2),price:(direction==='yes'?bidPrice:1-bidPrice).toFixed(4),
  reduce_only:true,time_in_force:'immediate_or_cancel',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true};
}
export function evaluateEntryTiming({candidate,sourceAgeMs,verifiedSettlement,freeCash}={}){
 if(!verifiedSettlement)return {action:'WAIT',reason:'UNVERIFIED_RULES'};
 if(!finite(Number(sourceAgeMs))||sourceAgeMs<0||sourceAgeMs>3000)return {action:'WAIT',reason:'STALE_MARKET'};
 const edge=Number(candidate?.netProfitDollars),cost=Number(candidate?.requiredDollars);
 if(!finite(edge)||edge<=0||!finite(cost)||cost<=0)return {action:'WAIT',reason:'NO_POSITIVE_NET_EDGE'};
 if(freeCash!=null&&(!finite(freeCash)||cost>freeCash+1e-8))return {action:'WAIT',reason:'INSUFFICIENT_FREE_CASH'};
 return {action:'QUALIFIED_NOW',reason:'POSITIVE_NET_EDGE_AT_CURRENT_QUOTE',estimatedReturnPercent:round(100*edge/cost)};
}
