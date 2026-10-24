/** Live Kalshi-only lifecycle. Processes only trades recorded as Kal Kings
 * solo orders; never automatically sells manual or DraftKings-hedged positions.
 * All read cash comes from Kalshi and settlement records are audit-only.
 */
import {cashAvailableForReinvestment,settlementEvidence,assessManagedExit,buildReductionOrder} from './kalshi_manager.mjs';
import {estimatedKalshiFee} from './engine.mjs';
const number=x=>Number(x);
export function makeKalshiLifecycle({fetchAccount,fetchSettlements,fetchMarket,sql,submit,createId,now=Date.now}){
 return async function monitor(){
  const account=await fetchAccount();
  const cash=cashAvailableForReinvestment(account);
  if(cash.status==='UNAVAILABLE')return {status:'ACCOUNT_UNAVAILABLE',freeCash:0,confirmedSettlements:0,exitsSubmitted:0,exitReceiptsConfirmed:0};
  const tracked=await sql("SELECT ticker,status,yes_filled::text AS yes_filled,no_filled::text AS no_filled,yes_price::text AS yes_price,no_price::text AS no_price FROM kal_kings_solo_orders WHERE status IN ('HEDGED','UNHEDGED','YES_FILLED','PARTIALLY_FILLED','UNCERTAIN','SUBMITTING') ORDER BY updated_at DESC LIMIT 100");
  const allSettlements=await fetchSettlements();
  const settled=Array.isArray(allSettlements)?allSettlements:[];
  const holdings=new Map((Array.isArray(account.holdings)?account.holdings:[]).map(p=>[p.ticker,p]));
  const result={status:'MONITORED',freeCash:cash.available,trackedPositions:tracked.length,confirmedSettlements:0,
    exitsSubmitted:0,exitReceiptsConfirmed:0,pendingReview:0};
  for(const trade of tracked){
    const proof=settlementEvidence(settled,trade.ticker);
    if(proof.status==='SETTLED'){
      await sql('INSERT INTO kal_kings_bot_settlements(ticker,settled_at) VALUES($1,$2::timestamptz) ON CONFLICT (ticker) DO NOTHING',[trade.ticker,proof.settledAt]);
      result.confirmedSettlements++;
      continue;
    }
    // Only a verified single uncovered YES position can be managed automatically.
    if(!['UNHEDGED','YES_FILLED'].includes(trade.status)){if(trade.status!=='HEDGED')result.pendingReview++;continue;}
    const desired=number(trade.yes_filled)-number(trade.no_filled);
    const actual=number(holdings.get(trade.ticker)?.position);
    const quantity=Math.floor(Math.min(desired,actual));
    if(!Number.isFinite(quantity)||quantity<1){result.pendingReview++;continue;}
    const prior=await sql('SELECT ticker,status,high_bid::text AS high_bid FROM kal_kings_position_watch WHERE ticker=$1',[trade.ticker]);
    if(prior.length&&['SUBMITTING','UNCERTAIN','CLOSED'].includes(prior[0].status)){if(prior[0].status!=='CLOSED')result.pendingReview++;continue;}
    let market;
    try{market=await fetchMarket(trade.ticker);}catch{result.pendingReview++;continue;}
    const age=now()-Date.parse(market?.observedAt||'');
    const bid=number(market?.yesBid),depth=number(market?.yesBidDepth);
    // High-water mark stores the best observed executable bid (not last trade).
    const maxPrior=number(prior[0]?.high_bid??trade.yes_price);
    const peak=Number.isFinite(bid)?Math.max(maxPrior,bid):maxPrior;
    await sql(`INSERT INTO kal_kings_position_watch(ticker,position_side,entry_price,high_bid,status,updated_at)
      VALUES($1,'yes',$2,$3,'WATCHING',now()) ON CONFLICT(ticker) DO UPDATE
      SET high_bid=GREATEST(kal_kings_position_watch.high_bid,EXCLUDED.high_bid),updated_at=now()
      WHERE kal_kings_position_watch.status='WATCHING'`,[trade.ticker,String(trade.yes_price),String(peak)]);
    const decision=assessManagedExit({entryPrice:number(trade.yes_price),bidPrice:bid,highestBid:peak,availableDepth:depth,
      quantity,quoteAgeMs:age,estimatedExitFee:estimatedKalshiFee(quantity,bid),stopLossPercent:12,takeProfitPercent:20,trailingPercent:10});
    if(decision.action!=='SELL')continue;
    const orderId=createId();
    const claimed=await sql(`UPDATE kal_kings_position_watch SET status='SUBMITTING',exit_client_order_id=$2::uuid,updated_at=now()
      WHERE ticker=$1 AND status='WATCHING' RETURNING ticker`,[trade.ticker,orderId]);
    if(!claimed.length)continue;
    result.exitsSubmitted++;
    try{
      const request=buildReductionOrder({ticker:trade.ticker,direction:'yes',quantity,bidPrice:bid,clientOrderId:orderId});
      const response=await submit(request);
      const filled=number(response?.fill_count);
      const state=Number.isFinite(filled)&&filled>=quantity?'CLOSED':filled===0?'WATCHING':'UNCERTAIN';
      await sql('UPDATE kal_kings_position_watch SET status=$2,exit_fill_count=$3,exit_order_id=$4,updated_at=now() WHERE ticker=$1',
       [trade.ticker,state,Number.isFinite(filled)?String(filled):null,String(response?.order_id||'').slice(0,128)||null]);
      if(state==='CLOSED')result.exitReceiptsConfirmed++;
      else if(state==='UNCERTAIN')result.pendingReview++;
    }catch{
      // Network timeout can happen after a fill. Never submit a new exit
      // without an exchange receipt and explicit reconciliation.
      await sql('UPDATE kal_kings_position_watch SET status=$2,updated_at=now() WHERE ticker=$1',[trade.ticker,'UNCERTAIN']);
      result.pendingReview++;
    }
  }
  return result;
 };
}
