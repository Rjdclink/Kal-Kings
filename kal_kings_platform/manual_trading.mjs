/**
 * Exchange-verified manual Kalshi trade ticket.
 *
 * Manual means the user explicitly chooses a speculative YES/NO purchase.
 * The trade preview never represents recent crypto momentum as profit.
 */
import {estimatedKalshiBuyDebit} from './engine.mjs';
import {normalizeKalshiBook,sweepAsks} from './quant.mjs';
const ok=n=>typeof n==='number'&&Number.isFinite(n);
const round4=n=>Math.round(n*10000)/10000;
const denied=reason=>({allowed:false,reason});
export function planManualKalshiBuy({market,bookResponse,feeSchedule,side,count,bankroll,
  now=Date.now(),maxBankrollFraction=.25}={}){
 if(!['yes','no'].includes(side)||!Number.isInteger(count)||count<1||count>50)
   return denied('INVALID_TICKET');
 if(!/^[A-Z0-9_-]{4,128}$/.test(market?.id||'')||
   !['open','active'].includes(market?.status))
   return denied('NO_OPEN_MATCHING_CONTRACT');
 const age=now-Date.parse(market?.observedAt||''),timeLeft=Date.parse(market?.closeTime||'')-now;
 if(!ok(age)||age<0||age>3000||!ok(timeLeft)||timeLeft<5000)
   return denied('STALE_OR_CLOSING_CONTRACT');
 const cash=Number(bankroll);
 if(!ok(cash)||cash<=0||!ok(maxBankrollFraction)||maxBankrollFraction<=0||
    maxBankrollFraction>.25)return denied('INSUFFICIENT_BANKROLL');
 const feeType=feeSchedule?.feeType,feeMultiplier=Number(feeSchedule?.feeMultiplier);
 if(!feeSchedule||!['quadratic','quadratic_with_maker_fees',
       'quadratic_with_combo_maker_fees'].includes(feeType)||
       !ok(feeMultiplier)||feeMultiplier<0||feeMultiplier>4)
   return denied('FEE_SCHEDULE_NOT_VERIFIED');
 let book;
 try{book=normalizeKalshiBook(bookResponse)}catch{return denied('ORDERBOOK_UNAVAILABLE')}
 const available=side==='yes'?book.yesAsks:book.noAsks;
 const sweep=sweepAsks(available,count);
 if(!sweep||!ok(sweep.worstPrice)||sweep.worstPrice<=0||sweep.worstPrice>=1)
   return denied('INSUFFICIENT_LIQUIDITY');
 const price=sweep.worstPrice,fullDebit=estimatedKalshiBuyDebit(count,price,{feeMultiplier});
 if(fullDebit>cash+1e-8||fullDebit>maxBankrollFraction*cash+1e-8)
   return denied('INSUFFICIENT_RISK_BUDGET');
 const fee=Math.max(0,fullDebit-price*count);
 return {allowed:true,reason:'MANUAL_LIMIT_ORDER_PREVIEW',ticker:market.id,side,count,
    limitPrice:price,feeMultiplier,feeType,estimatedFeeDollars:round4(fee),
    maxDebitDollars:fullDebit,maximumRiskBudgetDollars:Math.round(maxBankrollFraction*cash*10000)/10000,
    conditionalProfitIfWinDollars:round4(count-fullDebit),
    maximumLossIfLoseDollars:fullDebit,quoteObservedAt:market.observedAt,
    marketCloseTime:market.closeTime,priceBasis:'LIVE_EXCHANGE_ORDERBOOK',
    note:'A YES or NO signal is not a verified future outcome. Purchase is speculative and may lose the full debit.'};
}
export function buildManualBuyOrder(plan,clientOrderId){
 if(!plan?.allowed||!['yes','no'].includes(plan.side)||
   !Number.isInteger(plan.count)||plan.count<1||
   !/^[A-Z0-9_-]{4,128}$/.test(plan.ticker||'')||
   !/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(clientOrderId||''))
   throw RangeError('Invalid manual trade intent');
 const yesScale=plan.side==='yes'?plan.limitPrice:1-plan.limitPrice;
 if(!ok(yesScale)||yesScale<=0||yesScale>=1)throw RangeError('Invalid order price');
 return {ticker:plan.ticker,client_order_id:clientOrderId,
   side:plan.side==='yes'?'bid':'ask',
   count:plan.count.toFixed(2),price:yesScale.toFixed(4),
   time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',
   cancel_order_on_pause:true};
}
