/** Kal Kings Kalshi-only automated hedge planner.
 * No DraftKings betting interface is available through SharpAPI.
 * A real order is considered only AFTER the user reports an accepted opposing
 * DraftKings wager and the exact market's rules have been independently reviewed.
 */
import {evaluatePair,quoteAge,validPrice,estimatedKalshiFee} from './engine.mjs';
import {riskPolicy} from './strategy.mjs';

const fail=reason=>({accepted:false,reason});
export function buildKalshiHedgePlan({ticket,mapping,market,balance,now=Date.now()}={}){
  if(!ticket?.userConfirmed||ticket.status!=='open'||!mapping||ticket.pair_id!==mapping.id)
    return fail('UNCONFIRMED_OR_UNMATCHED_WAGER');
  if(mapping.kalshi_side!=='yes'||market?.id!==mapping.kalshi_ticker||ticket.selection!==mapping.dk_selection)
    return fail('CONTRACT_SIDE_OR_SELECTION_MISMATCH');
  const reviewed=Date.parse(mapping.reviewed_at??'');
  if(!/^sha256:[a-f0-9]{64}$/i.test(mapping.reviewed_rule_digest??'')||
      !Number.isFinite(reviewed)||reviewed>now||now-reviewed>7*86400000)
    return fail('REVIEW_EXPIRED');
  if(!validPrice(market?.yesAsk)||quoteAge(market,now)>3000||quoteAge(market,now)<0)
    return fail('MARKET_UNAVAILABLE_OR_STALE');
  const bank=Number(balance),depth=Math.floor(Number(market.yesDepth));
  if(!Number.isFinite(bank)||bank<1||!Number.isFinite(depth)||depth<1)
    return fail('NO_AVAILABLE_BANKROLL_OR_DEPTH');
  const limit=riskPolicy(bank).hardLossLimitDollars;
  const stake=Number(ticket.stake),odds=Number(ticket.odds);
  if(!Number.isFinite(stake)||stake<=0||!Number.isFinite(odds))return fail('INVALID_WAGER');
  let best=null;
  for(let count=1;count<=Math.min(depth,150);count++){
    const estimatedFee=estimatedKalshiFee(count,market.yesAsk);
    const expense=count*market.yesAsk+estimatedFee;
    if(expense>Math.min(limit,bank)+1e-9)break;
    let value;
    try{value=evaluatePair({contracts:count,kalshiAsk:market.yesAsk,dkStake:stake,dkAmerican:odds,feeUSD:estimatedFee,reviewed:true,sameResolution:true,dkAccepted:true},now);}catch{break;}
    if(!value.executableArbitrage)continue;
    if(!best||value.minimumProfit>best.minimumProfit)
      best={accepted:true,count,price:market.yesAsk,ticker:market.id,capitalRequired:expense,
        minimumProfit:value.minimumProfit,kalshiWinProfit:value.kalshiWins,dkWinProfit:value.draftKingsWins,
        estimatedKalshiFee:estimatedFee,source:'User-confirmed DraftKings ticket + reviewed market rules'};
  }
  return best||fail('NO_POSITIVE_HEDGE_WITHIN_RISK_LIMIT');
}
export function kalshiV2Order({ticker,count,yesPrice,clientOrderId}){
  if(!/^[A-Z0-9_-]{4,128}$/i.test(ticker)||!Number.isInteger(count)||count<1||
    !validPrice(yesPrice)||!/^[0-9a-f-]{36}$/i.test(clientOrderId))throw Error('Invalid Kalshi order');
  return {ticker,client_order_id:clientOrderId,side:'bid',count:count.toFixed(2),
    price:Number(yesPrice).toFixed(4),time_in_force:'fill_or_kill',
    self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true};
}
