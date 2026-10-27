/**
 * Bounded Kalshi directional execution for verified live-game value.
 * Deliberately independent of the two-leg YES/NO arbitrage worker.
 * Submitted orders are idempotent, FOK, and marked uncertain on timeouts.
 */
import {estimatedKalshiBuyDebit} from './engine.mjs';
import {normalizeKalshiBook} from './quant.mjs';
import {assessKalshiValue} from './strategy_optimizer.mjs';
import {assessAlreadyExceededTotal} from './total_strategy.mjs';
import {planLateGameOrder} from './sports_allocation.mjs';
import {cryptoConfidenceScore} from './crypto_candidate.mjs';
const validTicker=t=>/^[A-Z0-9_-]{4,128}$/.test(t||'');
const age=(v,now)=>now-Date.parse(v||'');
/**
 * Keep the official order book as primary. If its side is empty, use the
 * same fresh market endpoint's displayed ask and ask-size only when valid.
 * This allows a bounded FOK attempt without inventing executable liquidity.
 */
export function resolveExecutableAskBook(book,market,side,now=Date.now()){
 const empty={yesBids:[],noBids:[],yesAsks:[],noAsks:[]};
 const normalized=book&&typeof book==='object'?{
   yesBids:Array.isArray(book.yesBids)?book.yesBids:[],
   noBids:Array.isArray(book.noBids)?book.noBids:[],
   yesAsks:Array.isArray(book.yesAsks)?book.yesAsks:[],
   noAsks:Array.isArray(book.noAsks)?book.noAsks:[]
 }:empty;
 if(!['yes','no'].includes(side))return {book:normalized,source:null};
 const field=side==='yes'?'yesAsks':'noAsks';
 if(normalized[field].length)return {book:normalized,source:'ORDERBOOK'};
 const observed=Date.parse(market?.observedAt||'');
 const price=Number(side==='yes'?market?.yesAsk:market?.noAsk);
 const quantity=Number(side==='yes'?market?.yesDepth:market?.noDepth);
 const ageMs=now-observed;
 if(!['active','open'].includes(market?.status))
   return {book:normalized,source:null,reason:'FRESH_MARKET_NOT_OPEN'};
 if(!Number.isFinite(ageMs)||ageMs<0||ageMs>3000)
   return {book:normalized,source:null,reason:'STALE_MARKET_QUOTE'};
 const reasons=[];
 if(!Number.isFinite(price)||price<=0||price>=1)reasons.push('ASK_PRICE_INVALID_OR_AT_BOUNDARY');
 if(!Number.isFinite(quantity)||quantity<1)reasons.push('NO_DISPLAYED_ASK_SIZE');
 if(reasons.length)return {book:normalized,source:null,reason:reasons.join('_AND_')};
 return {book:{...normalized,[field]:[{price:Math.round(price*10000)/10000,quantity}]},
   source:'MARKET_TOP_OF_BOOK',reason:null};
}
export function makeDirectionalRunner({sql,fetchMarket,fetchOrderbook,fetchFeeSchedule,
 fetchFinalConsensus,submit,createId,now=Date.now}){
 return async function run({ideas=[],account}={}){
  const clock=now();
  if(account?.status!=='VERIFIED'||account?.positionsComplete!==true||
    !Number.isFinite(Number(account?.balance))||account.balance<=0||
    !Array.isArray(account?.holdings))return {status:'ACCOUNT_UNAVAILABLE'};
  const pending=await sql(`SELECT ticker FROM kal_kings_directional_orders
    WHERE status IN ('SUBMITTING','UNCERTAIN','PARTIALLY_FILLED','EXIT_SUBMITTING','EXIT_UNCERTAIN') LIMIT 1`);
  if(pending.length)return {status:'HALTED_PENDING_RECONCILIATION'};
  let reason='NO_CURRENT_INDEPENDENT_EDGE',alreadyAttempted=false,attempts=0,candidateChecks=0,lastCheckedTicker=null,lastCheckedStrategy=null;
  // Sports are the primary execution queue: already-exceeded totals first,
  // then verified late-game leads, and crypto only after sports candidates.
  const priority={TOTAL_ALREADY_OVER:0,LATE_GAME_LEAD:1,CRYPTO_DIRECTIONAL_CONSENSUS:2};
  const orderedIdeas=(Array.isArray(ideas)?ideas:[]).slice().sort((a,b)=>
    (priority[a?.strategy]??99)-(priority[b?.strategy]??99)||
    (Number(b?.maxAllocationFraction)||0)-(Number(a?.maxAllocationFraction)||0));
  for(const idea of orderedIdeas){
   candidateChecks++;
   const m=idea?.market,ticker=m?.ticker;
   lastCheckedTicker=validTicker(ticker)?ticker:null;lastCheckedStrategy=String(idea?.strategy||'').slice(0,64);
   const isTotal=idea?.strategy==='TOTAL_ALREADY_OVER';
   const isCrypto=idea?.strategy==='CRYPTO_DIRECTIONAL_CONSENSUS';
   if(!['LATE_GAME_LEAD','TOTAL_ALREADY_OVER','CRYPTO_DIRECTIONAL_CONSENSUS'].includes(idea?.strategy)||
      idea.sourceVerified!==true||idea.marketMatchVerified!==true||!validTicker(ticker)||
      (!isTotal&&!isCrypto&&idea.lateGameVerified!==true)||
      !Number.isFinite(age(idea.updatedAt,clock))||age(idea.updatedAt,clock)<0||
      age(idea.updatedAt,clock)>(isCrypto?30_000:20_000))continue;
   let finalConsensus=null;
   if(isCrypto){
    const modelAge=now()-Date.parse(idea.model?.observedAt||'');
    if(!['yes','no'].includes(idea.side)||idea.model?.status!=='ESTIMATED'||
       Number(idea.model.trials)<2500||modelAge<0||modelAge>30000||
       !ticker.startsWith('KX'+idea.symbol+'15M-'))continue;
    try{finalConsensus=await fetchFinalConsensus(idea.symbol,idea)}catch{reason='CONSENSUS_UNAVAILABLE';continue;}
    const elapsed=now()-Date.parse(finalConsensus?.updatedAt||'');
    if(finalConsensus?.direction!==(idea.side==='yes'?'UP':'DOWN')||
       Number(finalConsensus.agreeingSources)<5||finalConsensus.marketTicker!==ticker||
       !Number.isFinite(elapsed)||elapsed<0||elapsed>3000){
      reason='FINAL_CONSENSUS_CHANGED';continue;
    }
   }
   const prefix=ticker.slice(0,ticker.lastIndexOf('-')+1);
   if(account.holdings.some(x=>String(x?.ticker||'').startsWith(prefix)&&
      Number.isFinite(Number(x?.position))&&Number(x.position)!==0)){
     reason='CORRELATED_EXISTING_HOLDINGS';continue;
   }
   let fresh,book=null;
   try{fresh=await fetchMarket(ticker)}
   catch{reason='FRESH_MARKET_UNAVAILABLE_OR_INACTIVE';continue;}
   if(!fresh){reason='FRESH_MARKET_UNAVAILABLE_OR_INACTIVE';continue;}
   if(fresh.id!==ticker){reason='FRESH_MARKET_TICKER_MISMATCH';continue;}
   if(!['open','active'].includes(fresh.status)){reason='FRESH_MARKET_NOT_OPEN';continue;}
   try{book=normalizeKalshiBook(await fetchOrderbook(ticker))}
   catch{book=null}
   const orderSide=isCrypto&&idea.side==='no'?'no':'yes';
   const resolvedBook=resolveExecutableAskBook(book,fresh,orderSide,now());
   book=resolvedBook.book;
   if(!resolvedBook.source){
     reason=resolvedBook.reason||'NO_EXECUTABLE_ASK_DEPTH';continue;
   }
   if(!Number.isFinite(Date.parse(fresh.closeTime||''))||
      Date.parse(fresh.closeTime)<=now()+10000){reason='MARKET_CLOSING';continue;}
   const best=isCrypto&&idea.side==='no'?book.noAsks[0]:book.yesAsks[0];
   if(isCrypto&&(!/CF Benchmarks/i.test(fresh.rulesPrimary||'')||
      !/simple average/i.test(fresh.rulesPrimary||'')||
      !/at least/i.test(fresh.rulesPrimary||''))){reason='SETTLEMENT_RULES_UNVERIFIED';continue;}
   // The venue supplies series-specific multipliers. Unsupported flat fees,
   // missing metadata, or an unavailable schedule are not proof of profit.
   let feeSchedule=null;
   try{feeSchedule=typeof fetchFeeSchedule==='function'?await fetchFeeSchedule(ticker):null}
   catch{feeSchedule=null}
   const feeMultiplier=Number(feeSchedule?.feeMultiplier),feeType=feeSchedule?.feeType;
   if(!feeSchedule||!['quadratic','quadratic_with_maker_fees',
       'quadratic_with_combo_maker_fees'].includes(feeType)||
       !Number.isFinite(feeMultiplier)||feeMultiplier<0||feeMultiplier>4){
     reason='FEE_SCHEDULE_UNVERIFIED';continue;
   }
   const fee=Math.max(0,Math.round(
     (estimatedKalshiBuyDebit(1,best.price,{feeMultiplier})-best.price)*10000)/10000);
   const quote={...fresh,ticker,status:fresh.status,
     yesAsk:book.yesAsks?.[0]?.price,noAsk:book.noAsks?.[0]?.price,
     yesDepth:book.yesAsks?.[0]?.quantity,noDepth:book.noAsks?.[0]?.quantity,
     observedAt:fresh.observedAt};
   const finalScore=isCrypto?cryptoConfidenceScore(idea.probability,
     Math.min(Number(idea.agreeingSources),Number(finalConsensus?.agreeingSources))):null;
   if(isCrypto&&!finalScore?.tradeEligible){reason='FINAL_CONSENSUS_CONFIDENCE_BELOW_MINIMUM';continue;}
   const decision=isTotal?assessAlreadyExceededTotal({
       game:idea.game,market:quote,bankroll:Number(account.balance),
       feePerContract:fee,feeMultiplier,holdings:account.holdings,
       holdingsComplete:account.positionsComplete,now:now()
     }):!isCrypto?planLateGameOrder({game:idea.game,market:quote,
       bankroll:Number(account.balance),feePerContract:fee,
       holdings:account.holdings,now:now()
     }):assessKalshiValue({market:quote,side:idea.side,
       probability:idea.probability,
       probabilitySource:isCrypto?'CRYPTO_SCENARIO_PROXY':'ESPN_LIVE_MODEL',sourceVerified:true,marketMatchVerified:true,
       bankroll:Number(account.balance),holdings:account.holdings,
       feePerContract:fee,now:now(),maxLossProbability:.30,
       minimumEdge:isCrypto?.02:0,
       maxBankrollFraction:isCrypto?Math.min(Number(idea.allocationFraction),Number(finalConsensus.allocationFraction)):null,
       consensusConfidenceScorePercent:finalScore?.scorePercent??null});
   if(!decision.allowed){reason=decision.reason;continue;}
   // Final account-level affordability guard: never submit a trade whose
   // all-in debit is unknown or exceeds the currently verified cash balance.
   const availableCash=Number(account.balance);
   const allInDebit=Number(decision.estimatedMaxDebitDollars);
   if(!Number.isFinite(availableCash)||availableCash<=0||
      !Number.isFinite(allInDebit)||allInDebit<=0||allInDebit>availableCash){
     reason='INSUFFICIENT_VERIFIED_BANKROLL';continue;
   }
   // Each strategy's order planner already enforces its own bankroll cap.
   // A second unrelated 2% check would falsely veto profitable total orders.
   if(attempts>=4){reason='MAX_ORDER_ATTEMPTS_THIS_CYCLE';break;}
   const clientId=createId();
   const reservationParams=[ticker,String(idea.eventKey||ticker),idea.strategy,
      decision.side,String(decision.contracts),String(decision.limitPrice),
      String(decision.estimatedFeesDollars??decision.feePerContract*decision.contracts),
      decision.modeledWinProbability==null?null:String(decision.modeledWinProbability),
      String(decision.estimatedMaxDebitDollars),clientId];
   let inserted=await sql(`INSERT INTO kal_kings_directional_orders
     (ticker,event_key,strategy,side,contracts,entry_price,estimated_fees,modeled_probability,
      max_debit,client_order_id,status,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,$8::numeric,
       $9::numeric,$10::uuid,'SUBMITTING',now(),now())
     ON CONFLICT(ticker) DO NOTHING RETURNING ticker`,
     reservationParams);
   if(!inserted.length){
     // A *confirmed* FOK zero-fill leaves no position. It may be retried
     // after a short cooldown on an entirely fresh book and new client ID.
     // Unknown or partial fills must never enter this recovery path.
     inserted=await sql(`UPDATE kal_kings_directional_orders
       SET status='SUBMITTING',event_key=$2,strategy=$3,side=$4,
           contracts=$5::numeric,entry_price=$6::numeric,
           estimated_fees=$7::numeric,modeled_probability=$8::numeric,
           max_debit=$9::numeric,client_order_id=$10::uuid,
           exchange_order_id=NULL,filled_count=0,updated_at=now()
       WHERE ticker=$1 AND status='NOT_FILLED'
         AND updated_at<now()-interval '15 seconds'
       RETURNING ticker`,reservationParams);
     if(!inserted.length){alreadyAttempted=true;reason='ALREADY_ATTEMPTED';continue;}
   }
   attempts++;
   const request={ticker,client_order_id:clientId,action:'buy',side:decision.side,
      count:decision.contracts,type:'limit',
      ...(decision.side==='yes'?{yes_price_dollars:decision.limitPrice.toFixed(4)}:
        {no_price_dollars:decision.limitPrice.toFixed(4)}),
      time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',
      cancel_order_on_pause:true};
   let status='UNCERTAIN',exchangeId=null,filled=0,rejectionReason=null;
   try{
     const receipt=await submit(request);
     const n=Number(receipt?.fill_count);
     exchangeId=typeof receipt?.order_id==='string'?receipt.order_id.slice(0,128):null;
     filled=Number.isFinite(n)&&n>=0?n:0;
     status=!Number.isFinite(n)?'UNCERTAIN':n===0?'NOT_FILLED':
       n>=decision.contracts?'FILLED':'PARTIALLY_FILLED';
   }catch(e){
     const code=Number(e?.httpStatus||0);
     if([400,401,403,404,422,429].includes(code)){
       status='REJECTED';
       rejectionReason=code===403||code===401?
         'KALSHI_ORDER_PERMISSION_DENIED':code===429?
         'KALSHI_RATE_LIMITED':'KALSHI_ORDER_INVALID';
     }
     // Network failures, 409 duplicates, and server timeouts remain uncertain.
   }
   await sql(`UPDATE kal_kings_directional_orders
      SET status=$2,exchange_order_id=$3,filled_count=$4::numeric,
       high_bid=$5::numeric,updated_at=now() WHERE ticker=$1`,
      [ticker,status,exchangeId,String(filled),String(decision.limitPrice)]);
   // A verified fill count of zero means no position was opened. Look for
   // another independent market immediately, without waiting a full minute.
   if(status==='NOT_FILLED'){reason='CONFIRMED_NO_FILL';continue;}
   if(status==='REJECTED')return {status,reason:rejectionReason,ticker,filled:0,candidateChecks,orderSubmissionAttempts:attempts,lastCheckedTicker,lastCheckedStrategy};
   return {status,ticker,contracts:decision.contracts,filled,
     modeledWinProbability:decision.modeledWinProbability,
     estimatedMaxDebitDollars:decision.estimatedMaxDebitDollars,
     expectedNetDollars:decision.expectedNetDollars??decision.netIfNormallySettledDollars,
     strategy:idea.strategy,candidateChecks,orderSubmissionAttempts:attempts,lastCheckedTicker,lastCheckedStrategy};
  }
  return {status:alreadyAttempted?'ALREADY_ATTEMPTED':'NO_VERIFIED_DIRECTIONAL_EDGE',reason,candidateChecks,orderSubmissionAttempts:attempts,lastCheckedTicker,lastCheckedStrategy};
 };
}
