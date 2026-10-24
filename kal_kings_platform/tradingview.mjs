/** TradingView alert ingestion and separately attributed public spot trend analysis.
 * Alerts are evidence of what a user-configured TradingView alert said;
 * they do not establish an independent probability forecast or order instruction.
 */
import {createHash} from 'node:crypto';

const ALLOWED=new Set(['BTC','ETH','SOL','XRP','DOGE','ADA']);
const MAX_AGE=120000;
const formatTime=ms=>new Date(ms).toISOString();
const finite=n=>typeof n==='number'&&Number.isFinite(n);

export function canonicalSymbol(value){
  const normalized=String(value||'').trim().toUpperCase().replace(/^(?:[A-Z0-9_-]+):/,'').replace(/[\s_\/-]/g,'');
  const matched=/^(BTC|ETH|SOL|XRP|DOGE|ADA)(?:USD|USDT)$/.exec(normalized);
  if(!matched||!ALLOWED.has(matched[1]))throw RangeError('Unsupported TradingView symbol');
  return matched[1]+'/USD';
}
export function parseTradingViewAlert(payload,now=Date.now()){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw RangeError('Invalid TradingView alert');
  const symbol=canonicalSymbol(payload.ticker??payload.symbol);
  const action=String(payload.action??payload.signal??payload.direction??'').trim().toLowerCase();
  const direction=({buy:'BULLISH',long:'BULLISH',bullish:'BULLISH',sell:'BEARISH',short:'BEARISH',bearish:'BEARISH'})[action];
  if(!direction)throw RangeError('Unsupported TradingView alert action');
  const price=Number(payload.close??payload.price);
  if(!finite(price)||price<=0)throw RangeError('Invalid TradingView price');
  const givenTime=payload.time??payload.timestamp;
  const parsedTime=givenTime==null?now:typeof givenTime==='number'?(givenTime<1e12?givenTime*1000:givenTime):Date.parse(String(givenTime));
  if(!finite(parsedTime)||parsedTime-now>30000||now-parsedTime>MAX_AGE)throw RangeError('Stale or future TradingView alert');
  const interval=String(payload.interval??'').replace(/[^A-Za-z0-9]/g,'').slice(0,12)||null;
  const id=String(payload.id||'').trim().slice(0,96)||createHash('sha256').update(JSON.stringify({symbol,direction,price,interval,time:parsedTime})).digest('hex');
  return {id,symbol,direction,price,time:formatTime(parsedTime),receivedAt:formatTime(now),ageMs:now-parsedTime,interval,
    source:'TradingView user-configured alert',executionApproved:false};
}
export function mergeCryptoAlerts(spotRows,alerts,now=Date.now()){
  return (spotRows||[]).map(spot=>{
    const match=(alerts||[]).find(a=>a.symbol===spot.symbol&&a.time&&now-Date.parse(a.time)>=0&&now-Date.parse(a.time)<=MAX_AGE);
    return {...spot,tradingView:match?{id:match.id,direction:match.direction,price:match.price,time:match.time,
      source:'TradingView user-configured alert',executionApproved:false}:null};
  });
}
export function priceTrendFromCandles(candles){
  if(!Array.isArray(candles)||candles.length<30)throw RangeError('Insufficient completed candles');
  const prices=candles.map(r=>Number(r.close));
  if(prices.some(v=>!finite(v)||v<=0))throw RangeError('Invalid candle');
  const sma=n=>prices.slice(-n).reduce((a,b)=>a+b,0)/n;
  const fast=sma(8),slow=sma(21),reference=prices[prices.length-1-24];
  const change24=(prices.at(-1)/reference-1)*100;
  return {source:'Coinbase spot candles',trend:fast>slow?'UP':fast<slow?'DOWN':'FLAT',
    change24HoursPercent:Math.round(change24*100)/100,fastSma:fast,slowSma:slow,executionApproved:false,
    note:'A technical trend is not a calibrated price or contract outcome probability.'};
}
