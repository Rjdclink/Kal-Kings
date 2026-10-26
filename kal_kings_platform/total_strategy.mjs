/** Verified irreversible game-total screen; no outcome probabilities are invented. */
import {estimatedKalshiBuyDebit} from './engine.mjs';
import {monteCarloOverAllocation} from './sports_allocation.mjs';
const number=v=>v===null||v===undefined||v===''?NaN:Number(v);
const finite=Number.isFinite;
const denied=(reason,extra={})=>({allowed:false,strategy:'TOTAL_ALREADY_OVER',reason,...extra});
const codeFor=date=>{
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
 const x=new Date(date+'T12:00:00Z');
 if(!Number.isFinite(x.getTime())||x.toISOString().slice(0,10)!==date)return null;
 const code=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][x.getUTCMonth()];
 return String(x.getUTCDate()).padStart(2,'0')+code+String(x.getUTCFullYear()%100).padStart(2,'0');
};
export function assessAlreadyExceededTotal({
 game,market,bankroll,feePerContract,feeMultiplier=null,holdings=[],holdingsComplete=true,now=Date.now()
}={}){
 if(!game||game.state!=='in')return denied('NOT_LIVE');
 const observed=now-Date.parse(game.updatedAt||'');
 const home=number(game.homeScore),away=number(game.awayScore);
 if(!finite(observed)||observed<0||observed>20000||
   !finite(home)||!finite(away)||home<0||away<0)return denied('STALE_OR_INVALID_GAME_SCORE');
 const series={NFL:'KXNFLTOTAL',NBA:'KXNBATOTAL',NHL:'KXNHLTOTAL'}[game.sport];
 const dateCode=codeFor(game.date);
 const a=String(game.awayAbbreviation||'').toUpperCase(),h=String(game.homeAbbreviation||'').toUpperCase();
 const ticker=String(market?.ticker||'');
 if(!series||!dateCode||!/^[A-Z]{2,4}$/.test(a)||!/^[A-Z]{2,4}$/.test(h)||
   a===h||![series+'-'+dateCode+a+h+'-',series+'-'+dateCode+h+a+'-']
     .some(prefix=>ticker.startsWith(prefix)))
   return denied('GAME_IDENTIFIERS_NOT_MATCHED');
 if(!['active','open'].includes(market?.status))return denied('MARKET_NOT_OPEN');
 const line=number(market.floorStrike),score=home+away;
 if(!finite(line)||line<=0||score<=line)return denied('TOTAL_NOT_YET_EXCEEDED');
 const rules=String(market.rulesPrimary||'');
 if(!/collectively score more than/i.test(rules)||!rules.includes(String(line))||
    !/resolves? to Yes/i.test(rules))
   return denied('OFFICIAL_SETTLEMENT_RULES_NOT_VERIFIED');
 const quoteAge=now-Date.parse(market.observedAt||''),timeLeft=Date.parse(market.closeTime||'')-now;
 if(!finite(quoteAge)||quoteAge<0||quoteAge>3000||!finite(timeLeft)||timeLeft<=10000)
   return denied('MARKET_QUOTE_STALE_OR_CLOSING');
 if(!holdingsComplete||!Array.isArray(holdings))return denied('ACCOUNT_POSITIONS_NOT_VERIFIED');
 if(holdings.some(x=>x?.ticker===ticker&&finite(number(x.position))&&number(x.position)!==0))
   return denied('EXISTING_POSITION_IN_MARKET');
 const ask=number(market.yesAsk),depth=number(market.yesDepth),
   fee=number(feePerContract),cash=number(bankroll);
 if(!finite(ask)||ask<=0||ask>=1||!finite(depth)||depth<1||
   !finite(fee)||fee<0||!finite(cash)||cash<=0)
   return denied('UNEXECUTABLE_PRICE_OR_CASH');
 // Evaluate EACH affordable order size. A retail order's fee accumulator
 // spans all its fills, so three 99-cent contracts may be net positive
 // even though one individually is merely break-even.
 const verifiedFee=feeMultiplier!==null;
 if(verifiedFee&&(!finite(number(feeMultiplier))||number(feeMultiplier)<0||
   number(feeMultiplier)>4))return denied('SERIES_FEE_NOT_VERIFIED');
 const sizing=monteCarloOverAllocation({bankroll:cash,price:ask,depth,seed:113});
 const budget=Math.min(cash,cash*sizing.allocationFraction);
 const maxCount=Math.min(5000,Math.floor(depth),Math.floor(budget/ask));
 let best=null;
 for(let n=1;n<=maxCount;n++){
   const debit=verifiedFee?
     estimatedKalshiBuyDebit(n,ask,{feeMultiplier:number(feeMultiplier)}):
     Math.round(n*(ask+fee)*10000)/10000;
   if(debit>budget+1e-9||debit>cash+1e-9)continue;
   const net=n-debit;
   if(net<=1e-9)continue;
   if(!best||net>best.net+1e-9||(Math.abs(net-best.net)<1e-9&&debit<best.debit)){
     best={count:n,debit,net};
   }
 }
 if(!best)return denied('NO_NET_POSITIVE_SETTLEMENT_MARGIN_OR_BUDGET');
 const count=best.count,feeTotal=Math.max(0,best.debit-count*ask);
 return {allowed:true,strategy:'TOTAL_ALREADY_OVER',reason:'SCORE_ALREADY_OVER_RULES_VERIFIED',
  ticker,side:'yes',contracts:count,limitPrice:ask,feePerContract:fee,
  estimatedFeesDollars:Math.round(feeTotal*10000)/10000,
  feeBasis:verifiedFee?'VERIFIED_SERIES_MULTIPLIER':'CONSERVATIVE_SINGLE_CONTRACT_FEE',
  netIfNormallySettledDollars:Math.round(best.net*10000)/10000,
  estimatedMaxDebitDollars:Math.round(best.debit*10000)/10000,
  modeledWinProbability:null,modeledLossFrequency:null,conditionalPayoutDollars:count,
  bankrollAllocationFraction:sizing.allocationFraction,allocationMonteCarloTrials:sizing.trials,
  score,totalLine:line,eventKey:series+'-'+dateCode+a+h,
  note:'Score is already above the official threshold; corrections, voids, delays, and execution fees remain possible.'};
}

/** Separate proof check used by market discovery before account funding is read.
 * An official live total already above its threshold is not a prediction.
 */
export function verifyExceededTotal({game,market,now=Date.now()}={}){
 const no=reason=>({eligible:false,reason});
 if(!game||game.state!=='in')return no('GAME_NOT_LIVE');
 const scoreAge=now-Date.parse(game.updatedAt||''),quoteAge=now-Date.parse(market?.observedAt||'');
 if(!finite(scoreAge)||scoreAge<0||scoreAge>20000||
   !finite(quoteAge)||quoteAge<0||quoteAge>3000)return no('STALE_SCORE_OR_QUOTE');
 const home=number(game.homeScore),away=number(game.awayScore),line=number(market?.floorStrike);
 if(!finite(home)||!finite(away)||home<0||away<0||!finite(line)||line<=0||
    home+away<=line)return no('NO_VERIFIED_CROSSED_THRESHOLD');
 const type={NFL:'KXNFLTOTAL',NBA:'KXNBATOTAL',NHL:'KXNHLTOTAL'}[game.sport],
   day=codeFor(game.date),a=String(game.awayAbbreviation||'').toUpperCase(),
   h=String(game.homeAbbreviation||'').toUpperCase(),ticker=String(market?.ticker||'');
 if(!type||!day||!a||!h||a===h||!['active','open'].includes(market.status)||
    ![type+'-'+day+a+h+'-',type+'-'+day+h+a+'-'].some(prefix=>ticker.startsWith(prefix)))
   return no('UNMATCHED_OR_CLOSED_CONTRACT');
 const rules=String(market.rulesPrimary||'');
 if(!/collectively score more than/i.test(rules)||!rules.includes(String(line))||
    !/resolves? to Yes/i.test(rules))return no('UNVERIFIED_RULES');
 if(Date.parse(market.closeTime||'')<=now+10000)return no('CLOSING');
 return {eligible:true,reason:'OFFICIAL_SCORE_ALREADY_OVER',ticker,actualTotal:home+away,
   threshold:line,conditionalOutcomeVerified:true,
   note:'The score is already over the stated threshold; corrections and voids remain possible.'};
}
