/**
 * Bounded Kalshi directional execution for verified live-game value.
 * Deliberately independent of the two-leg YES/NO arbitrage worker.
 * Submitted orders are idempotent, FOK, and marked uncertain on timeouts.
 */
import {estimatedKalshiFee} from './engine.mjs';
import {normalizeKalshiBook} from './quant.mjs';
import {assessKalshiValue} from './strategy_optimizer.mjs';
import {assessAlreadyExceededTotal} from './total_strategy.mjs';
const validTicker=t=>/^[A-Z0-9_-]{4,128}$/.test(t||'');
const age=(v,now)=>now-Date.parse(v||'');
export function makeDirectionalRunner({sql,fetchMarket,fetchOrderbook,submit,createId,now=Date.now}){
 return async function run({ideas=[],account}={}){
  const clock=now();
  if(account?.status!=='VERIFIED'||account?.positionsComplete!==true||
    !Number.isFinite(Number(account?.balance))||account.balance<=0||
    !Array.isArray(account?.holdings))return {status:'ACCOUNT_UNAVAILABLE'};
  const pending=await sql(`SELECT ticker FROM kal_kings_directional_orders
    WHERE status IN ('SUBMITTING','UNCERTAIN','PARTIALLY_FILLED','EXIT_SUBMITTING','EXIT_UNCERTAIN') LIMIT 1`);
  if(pending.length)return {status:'HALTED_PENDING_RECONCILIATION'};
  let reason='NO_CURRENT_INDEPENDENT_EDGE',alreadyAttempted=false;
  for(const idea of Array.isArray(ideas)?ideas:[]){
   const m=idea?.market,ticker=m?.ticker;
   const isTotal=idea?.strategy==='TOTAL_ALREADY_OVER';
   if(!['LATE_GAME_LEAD','TOTAL_ALREADY_OVER'].includes(idea?.strategy)||
      idea.sourceVerified!==true||idea.marketMatchVerified!==true||!validTicker(ticker)||
      (!isTotal&&(!idea.modelPlayId||typeof idea.modelPlayId!=='string'))||
      !Number.isFinite(age(idea.updatedAt,clock))||age(idea.updatedAt,clock)<0||
      age(idea.updatedAt,clock)>10_000)continue;
   const prefix=ticker.slice(0,ticker.lastIndexOf('-')+1);
   if(account.holdings.some(x=>String(x?.ticker||'').startsWith(prefix)&&
      Number.isFinite(Number(x?.position))&&Number(x.position)!==0)){
     reason='CORRELATED_EXISTING_HOLDINGS';continue;
   }
   let fresh,book;
   try{
     [fresh,book]=await Promise.all([fetchMarket(ticker),fetchOrderbook(ticker)]);
     book=normalizeKalshiBook(book);
   }catch{reason='ORDERBOOK_OR_REQUOTE_UNAVAILABLE';continue;}
   if(!fresh||fresh.id!==ticker||!['open','active'].includes(fresh.status)||!book.yesAsks?.length){
     reason='LIVE_MARKET_NOT_OPEN';continue;
   }
   if(!Number.isFinite(Date.parse(fresh.closeTime||''))||
      Date.parse(fresh.closeTime)<=now()+30000){reason='MARKET_CLOSING';continue;}
   const best=book.yesAsks[0];
   // Reserve the worst per-order unit fee across plausible price improvement.
   const fee=Math.max(estimatedKalshiFee(1,best.price),estimatedKalshiFee(1,.5));
   const quote={...fresh,ticker,status:fresh.status,yesAsk:best.price,
     yesDepth:best.quantity,observedAt:fresh.observedAt};
   const decision=isTotal?assessAlreadyExceededTotal({
       game:idea.game,market:quote,bankroll:Number(account.balance),
       feePerContract:fee,holdings:account.holdings,
       holdingsComplete:account.positionsComplete,now:now()
     }):assessKalshiValue({market:quote,side:'yes',
       probability:idea.externalWinProbability??idea.probability,
       probabilitySource:'ESPN_LIVE_MODEL',sourceVerified:true,marketMatchVerified:true,
       bankroll:Number(account.balance),holdings:account.holdings,
       feePerContract:fee,now:now(),maxLossProbability:.15});
   if(!decision.allowed){reason=decision.reason;continue;}
   if(decision.contracts!==1&&decision.estimatedMaxDebitDollars>Number(account.balance)*.02+1e-8){
     reason='CONCENTRATION_LIMIT';continue;
   }
   const clientId=createId();
   const inserted=await sql(`INSERT INTO kal_kings_directional_orders
     (ticker,event_key,strategy,side,contracts,entry_price,estimated_fees,modeled_probability,
      max_debit,client_order_id,status,created_at,updated_at)
     VALUES($1,$2,$3,'yes',$4::numeric,$5::numeric,$6::numeric,$7::numeric,
       $8::numeric,$9::uuid,'SUBMITTING',now(),now())
     ON CONFLICT(ticker) DO NOTHING RETURNING ticker`,
     [ticker,String(idea.eventKey||ticker),idea.strategy,
      String(decision.contracts),String(decision.limitPrice),String(decision.feePerContract),
      decision.modeledWinProbability==null?null:String(decision.modeledWinProbability),
      String(decision.estimatedMaxDebitDollars),clientId]);
   if(!inserted.length){alreadyAttempted=true;reason='ALREADY_ATTEMPTED';continue;}
   const request={ticker,client_order_id:clientId,side:'bid',
      count:decision.contracts.toFixed(2),price:decision.limitPrice.toFixed(4),
      time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',
      cancel_order_on_pause:true};
   let status='UNCERTAIN',exchangeId=null,filled=0;
   try{
     const receipt=await submit(request);
     const n=Number(receipt?.fill_count);
     exchangeId=typeof receipt?.order_id==='string'?receipt.order_id.slice(0,128):null;
     filled=Number.isFinite(n)&&n>=0?n:0;
     status=!Number.isFinite(n)?'UNCERTAIN':n===0?'NOT_FILLED':
       n>=decision.contracts?'FILLED':'PARTIALLY_FILLED';
   }catch{/* A network failure can occur after Kalshi accepted the order. */}
   await sql(`UPDATE kal_kings_directional_orders
      SET status=$2,exchange_order_id=$3,filled_count=$4::numeric,
       high_bid=$5::numeric,updated_at=now() WHERE ticker=$1`,
      [ticker,status,exchangeId,String(filled),String(decision.limitPrice)]);
   return {status,ticker,contracts:decision.contracts,filled,
     modeledWinProbability:decision.modeledWinProbability,
     estimatedMaxDebitDollars:decision.estimatedMaxDebitDollars,
     expectedNetDollars:decision.expectedNetDollars??decision.netIfNormallySettledDollars,
     strategy:idea.strategy};
  }
  return {status:alreadyAttempted?'ALREADY_ATTEMPTED':'NO_VERIFIED_DIRECTIONAL_EDGE',reason};
 };
}
