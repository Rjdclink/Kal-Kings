/** One-shot, tightly bounded live Kalshi connectivity trade.
 * This is an explicit integration test, not a profitability recommendation or
 * an automated strategy. Only one YES contract, never more than $0.03 at risk.
 */
import {normalizeKalshiBook,sweepAsks} from './quant.mjs';
import {estimatedKalshiFee} from './engine.mjs';
export const MICRO_TEST_MAX_OUTLAY=0.03;
export function planOneTimeMicroOrder({ticker,marketStatus,yesAsk,book,balance,positionsComplete}={}){
  const reject=reason=>({allowed:false,reason});
  if(!/^[A-Z0-9_-]{4,128}$/.test(ticker||'')||marketStatus!=='active')return reject('MARKET_NOT_ACTIVE');
  if(positionsComplete!==true)return reject('ACCOUNT_POSITIONS_INCOMPLETE');
  if(!Number.isFinite(balance)||balance<=0)return reject('CASH_UNAVAILABLE');
  if(!Number.isFinite(yesAsk)||yesAsk<=0||yesAsk>0.02)return reject('NO_LOW_COST_MARKET');
  let quotes;
  try{quotes=normalizeKalshiBook(book)}catch{return reject('INVALID_BOOK');}
  const sweep=sweepAsks(quotes.yesAsks,1);
  if(!sweep||!Number.isFinite(sweep.worstPrice)||sweep.worstPrice>0.02)return reject('NO_EXECUTABLE_CHEAP_ASK');
  if(Math.abs(sweep.worstPrice-yesAsk)>0.0001)return reject('QUOTE_DISAGREEMENT');
  const price=sweep.worstPrice,estimatedFee=estimatedKalshiFee(1,price);
  const fullCost=Math.ceil((price+estimatedFee-1e-9)*100)/100;
  if(fullCost>MICRO_TEST_MAX_OUTLAY+1e-8||fullCost>balance+1e-8)return reject('INSUFFICIENT_CASH_FOR_TEST');
  return {allowed:true,source:'KALSHI_ONLY',purpose:'ONE_TIME_LIVE_CONNECTIVITY_TEST',
    marketTicker:ticker,side:'bid',outcome:'yes',contracts:1,price,
    estimatedFeeDollars:estimatedFee,totalMaxDollars:fullCost,
    warning:'One-sided speculative test, not a hedged arbitrage and not validated positive expected value.'};
}
export function interpretMicroReceipt({post,confirmed}={}){
 const count=Number(post?.fill_count);
 if(!Number.isFinite(count)||count<0||count>1||typeof post?.order_id!=='string'||!post.order_id)return 'UNCERTAIN';
 if(count===0)return 'NOT_FILLED';
 const remote=confirmed?.order;
 if(remote?.order_id!==post.order_id||Number(remote.fill_count_fp)<1)return 'UNCERTAIN';
 return 'FILLED';
}
