/** One explicit dashboard action is required per real-money manual order.
 * Previews never submit. Intents are claimed atomically before Kalshi POST.
 */
import {planManualKalshiBuy,buildManualBuyOrder} from './manual_trading.mjs';
const tickerOk=t=>typeof t==='string'&&/^[A-Z0-9_-]{4,128}$/.test(t);
const uuidOk=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
export function makeManualExecutor({sql,fetchAccount,fetchMarket,fetchOrderbook,
 fetchFeeSchedule,submit,createId,now=Date.now}){
 async function livePlan({ticker,side,count}){
   const [account,market,book,fees]=await Promise.all([
     fetchAccount(),fetchMarket(ticker),fetchOrderbook(ticker),fetchFeeSchedule(ticker)
   ]);
   if(account?.status!=='VERIFIED'||account?.positionsComplete!==true||
      !Array.isArray(account?.holdings))return {allowed:false,reason:'ACCOUNT_UNAVAILABLE'};
   return planManualKalshiBuy({market,bookResponse:book,feeSchedule:fees,
      side,count,bankroll:Number(account.balance),now:now()});
 }
 async function preview({ticker,side,count}={}){
   if(!tickerOk(ticker)||!['yes','no'].includes(side)||!Number.isInteger(count)||
      count<1||count>50)return {allowed:false,reason:'INVALID_ORDER_REQUEST'};
   let plan;
   try{plan=await livePlan({ticker,side,count})}
   catch{return {allowed:false,reason:'LIVE_QUOTE_UNAVAILABLE'}}
   if(!plan?.allowed)return plan;
   const id=createId(),orderId=createId();
   if(!uuidOk(id)||!uuidOk(orderId)||id===orderId)return {allowed:false,reason:'ORDER_ID_UNAVAILABLE'};
   const expiresAt=new Date(now()+30000).toISOString();
   await sql(`INSERT INTO kal_kings_manual_intents
      (id,ticker,side,contracts,limit_price,max_debit,client_order_id,status,expires_at)
      VALUES($1::uuid,$2,$3,$4::integer,$5::numeric,$6::numeric,$7::uuid,
       'PREVIEW',now()+interval '30 seconds')
      RETURNING id`,
      [id,ticker,side,String(count),String(plan.limitPrice),
       String(plan.maxDebitDollars),orderId]);
   return {...plan,intentId:id,expiresAt,
     note:'No order has been sent. Confirm to buy this speculative contract.'};
 }
 async function execute({intentId}={}){
   if(!uuidOk(intentId))return {status:'INVALID_INTENT'};
   // One and only one caller can claim a previewed intent. Stale, already
   // accepted, or partially filled orders cannot accidentally be resubmitted.
   const claimed=await sql(`UPDATE kal_kings_manual_intents
     SET status='SUBMITTING',updated_at=now()
     WHERE id=$1::uuid AND status='PREVIEW' AND expires_at>now()
     RETURNING id,ticker,side,contracts::integer AS count,
       limit_price::text AS limit_price,max_debit::text AS max_debit,
       client_order_id`,[intentId]);
   const row=claimed?.[0];
   if(!row)return {status:'ALREADY_ATTEMPTED'};
   let plan;
   try{plan=await livePlan({ticker:row.ticker,side:row.side,count:Number(row.count)})}
   catch{plan={allowed:false,reason:'LIVE_REQUOTE_UNAVAILABLE'}}
   if(!plan?.allowed||plan.ticker!==row.ticker||plan.side!==row.side||
      plan.count!==Number(row.count)||
      plan.limitPrice>Number(row.limit_price)+1e-8||
      plan.maxDebitDollars>Number(row.max_debit)+1e-8){
     const reason=plan?.allowed?'QUOTE_MOVED_OR_COST_INCREASED':plan?.reason||'RECHECK_FAILED';
     await sql(`UPDATE kal_kings_manual_intents SET status=$2,
       updated_at=now() WHERE id=$1::uuid`,[intentId,'NOT_ELIGIBLE']);
     return {status:'NOT_ELIGIBLE',reason};
   }
   let status='UNCERTAIN',exchangeOrderId=null,filled=0;
   try{
     const order=buildManualBuyOrder(plan,row.client_order_id);
     const response=await submit(order);
     exchangeOrderId=typeof response?.order_id==='string'?response.order_id.slice(0,128):null;
     const n=Number(response?.fill_count);
     if(Number.isFinite(n)&&n>=0&&n<=plan.count){
       filled=n;
       status=n===0?'NOT_FILLED':n>=plan.count?'FILLED':'PARTIALLY_FILLED';
     }
   }catch{/* Kalshi may have accepted the order before the connection failed. */}
   await sql(`UPDATE kal_kings_manual_intents
       SET status=$2,exchange_order_id=$3,filled_count=$4::numeric,
       updated_at=now() WHERE id=$1::uuid`,
       [intentId,status,exchangeOrderId,String(filled)]);
   return {status,ticker:plan.ticker,side:plan.side,count:plan.count,
     filled,limitPrice:plan.limitPrice,maxDebitDollars:plan.maxDebitDollars,
     orderId:exchangeOrderId,
     note:status==='UNCERTAIN'?'Exchange receipt was inconclusive; do not retry before reconciling Kalshi.':
       'Only exchange-confirmed fills represent purchased contracts.'};
 }
 return {preview,execute};
}
