/** Manages ONLY Kal Kings' own confirmed directional orders. Never touches other holdings. */
import {estimatedKalshiFee} from './engine.mjs';
import {normalizeKalshiBook} from './quant.mjs';
import {assessManagedExit,buildReductionOrder} from './kalshi_manager.mjs';
import {adaptiveExitThresholds,bidVolatilityPct} from './strategy_optimizer.mjs';
const finite=n=>Number.isFinite(Number(n));
const marketAge=(q,now)=>now-Date.parse(q?.observedAt||'');
export function makeDirectionalLifecycle({
 sql,fetchMarket,fetchOrderbook,fetchSettlements,submit,createId,
 getBidHistory=async()=>[],recordQuote=async()=>{},now=Date.now
}){
 return async function monitor(account={}){
  if(account.status!=='MONITORED'||account.positionsComplete!==true||!Array.isArray(account.holdings))
    return {status:'ACCOUNT_UNAVAILABLE',pendingReview:0,exitsSubmitted:0};
  const trades=await sql(`SELECT ticker,side,status,contracts::text AS contracts,
    filled_count::text AS filled_count,entry_price::text AS entry_price,
    high_bid::text AS high_bid,modeled_probability::text AS modeled_probability,event_key
    FROM kal_kings_directional_orders
    WHERE status IN ('FILLED','PARTIALLY_FILLED','SUBMITTING','UNCERTAIN',
      'EXIT_SUBMITTING','EXIT_UNCERTAIN')
    ORDER BY updated_at DESC LIMIT 30`);
  let settled=[];
  try{settled=await fetchSettlements()}catch{/* A missing settlement feed does not justify an exit. */}
  const holdings=new Map(account.holdings.map(p=>[p.ticker,Number(p.position)]));
  const out={status:'MONITORED',trackedPositions:trades.length,pendingReview:0,
    exitsSubmitted:0,exitReceiptsConfirmed:0,confirmedSettlements:0};
  for(const trade of trades){
   const evidence=(Array.isArray(settled)?settled:[]).find(x=>
      x.ticker===trade.ticker&&x.settled_time&&['yes','no','void','scalar'].includes(x.market_result));
   if(evidence){
     await sql(`UPDATE kal_kings_directional_orders SET status='SETTLED',
       settled_at=$2::timestamptz,updated_at=now()
       WHERE ticker=$1 AND status NOT IN ('SETTLED','CLOSED')`,
       [trade.ticker,evidence.settled_time]);
     out.confirmedSettlements++;continue;
   }
   if(trade.status!=='FILLED'){out.pendingReview++;continue;}
   const count=Math.floor(Number(trade.filled_count)),signedHeld=holdings.get(trade.ticker);
   const held=trade.side==='no'?-signedHeld:signedHeld;
   // Exact ticker and confirmed Kalshi exposure are both required.
   if(!Number.isInteger(count)||count<1||!finite(held)||held<count){
     out.pendingReview++;continue;
   }
   let market,book;
   try{
     [market,book]=await Promise.all([fetchMarket(trade.ticker),fetchOrderbook(trade.ticker)]);
     book=normalizeKalshiBook(book);
   }catch{continue;}
   if(market?.id!==trade.ticker||!['open','active'].includes(market.status)||
     !finite(marketAge(market,now()))||marketAge(market,now())<0||
     marketAge(market,now())>3000)continue;
   const levels=trade.side==='no'?book.noBids:book.yesBids;
   const best=levels?.[0];
   if(!best||!finite(best.quantity)||best.quantity<count)continue;
   const bid=Number(best.price);
   if(!finite(bid)||bid<=0||bid>=1)continue;
   const prior=Number(trade.high_bid??trade.entry_price);
   const peak=Math.max(bid,Number.isFinite(prior)?prior:bid);
   await sql(`UPDATE kal_kings_directional_orders
      SET high_bid=GREATEST(COALESCE(high_bid,0),$2::numeric),updated_at=now()
      WHERE ticker=$1 AND status='FILLED'`,[trade.ticker,String(peak)]);
   try{await recordQuote({...market,yesBid:bid})}catch{/* Journal is optional for protective exits. */}
   let historical=[];
   try{historical=await getBidHistory(trade.ticker)}catch{}
   const observedVolatility=bidVolatilityPct(historical);
   const thresholds=adaptiveExitThresholds({volatilityPct:observedVolatility??5,
     confidence:Number(trade.modeled_probability)});
   const decision=assessManagedExit({entryPrice:Number(trade.entry_price),
     bidPrice:bid,highestBid:peak,availableDepth:best.quantity,
     quantity:count,quoteAgeMs:marketAge(market,now()),
     estimatedExitFee:estimatedKalshiFee(count,bid),...thresholds});
   if(decision.action!=='SELL')continue;
   const id=createId();
   const locked=await sql(`UPDATE kal_kings_directional_orders
      SET status='EXIT_SUBMITTING',exit_client_order_id=$2::uuid,updated_at=now()
      WHERE ticker=$1 AND status='FILLED' RETURNING ticker`,[trade.ticker,id]);
   if(!locked.length)continue;
   out.exitsSubmitted++;
   let status='EXIT_UNCERTAIN',orderId=null,filled=0;
   try{
     const reduce=buildReductionOrder({ticker:trade.ticker,direction:trade.side,
       quantity:count,bidPrice:bid,clientOrderId:id});
     const receipt=await submit(reduce);
     const n=Number(receipt?.fill_count);
     orderId=typeof receipt?.order_id==='string'?receipt.order_id.slice(0,128):null;
     filled=Number.isFinite(n)&&n>=0?n:0;
     status=!Number.isFinite(n)?'EXIT_UNCERTAIN':
       n>=count?'CLOSED':n===0?'FILLED':'EXIT_UNCERTAIN';
   }catch{/* A timeout may follow actual execution. Never retry an uncertain exit. */}
   await sql(`UPDATE kal_kings_directional_orders SET status=$2,
     exit_order_id=$3,exit_filled_count=$4::numeric,updated_at=now() WHERE ticker=$1`,
     [trade.ticker,status,orderId,String(filled)]);
   if(status==='CLOSED')out.exitReceiptsConfirmed++;
   if(status==='EXIT_UNCERTAIN')out.pendingReview++;
  }
  return out;
 };
}
