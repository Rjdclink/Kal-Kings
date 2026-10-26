/** Last-second independent executable-market price votes.
 * Live bid/ask snapshots compare seven venues to Kalshi's published CF target.
 * These votes confirm price level, not a guarantee of settlement.
 */
const venueNames=['coinbase','kraken','bitstamp','gemini','okx','kucoin','bitfinex'];
const symbols=new Set(['BTC','ETH','SOL','XRP','DOGE','ADA']);
const numeric=x=>x==null||x===''?NaN:Number(x);
const pOk=x=>Number.isFinite(x)&&x>0;
const quoteUrl=(venue,symbol)=>{
 const pair=symbol==='BTC'?'XBT':symbol;
 const low=symbol.toLowerCase();
 return {
  coinbase:`https://api.exchange.coinbase.com/products/${symbol}-USD/ticker`,
  kraken:`https://api.kraken.com/0/public/Ticker?pair=${pair}USD`,
  bitstamp:`https://www.bitstamp.net/api/v2/ticker/${low}usd/`,
  gemini:`https://api.gemini.com/v1/pubticker/${low}usd`,
  okx:`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`,
  kucoin:`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${symbol}-USDT`,
  bitfinex:`https://api-pub.bitfinex.com/v2/ticker/t${symbol}USD`
 }[venue];
};
function readBidAsk(venue,j){
 let bid,ask,timestamp=null;
 switch(venue){
  case 'coinbase':
   bid=j?.bid;ask=j?.ask;timestamp=Date.parse(j?.time||'');break;
  case 'kraken':{
   const value=Object.values(j?.result||{}).find(x=>Array.isArray(x?.a)&&Array.isArray(x?.b));
   if(j?.error?.length||!value)return null;
   bid=value.b[0];ask=value.a[0];break;
  }
  case 'bitstamp':
   bid=j?.bid;ask=j?.ask;timestamp=numeric(j?.timestamp)*1000;break;
  case 'gemini':
   bid=j?.bid;ask=j?.ask;break;
  case 'okx':
   if(j?.code!=='0')return null;
   bid=j?.data?.[0]?.bidPx;ask=j?.data?.[0]?.askPx;
   timestamp=numeric(j?.data?.[0]?.ts);break;
  case 'kucoin':
   if(j?.code!=='200000')return null;
   bid=j?.data?.bestBid;ask=j?.data?.bestAsk;
   timestamp=numeric(j?.data?.time);break;
  case 'bitfinex':
   bid=j?.[0];ask=j?.[2];break;
  default:return null;
 }
 bid=numeric(bid);ask=numeric(ask);
 if(!pOk(bid)||!pOk(ask)||ask<bid||ask/bid>1.015)return null;
 return {price:(bid+ask)/2,timestamp};
}
export async function fetchFinalCryptoConsensus({fetcher=fetch,symbol,ticker,
 referencePrice,now=Date.now(),minMovePct=.005}={}){
 const invalid={symbol,marketTicker:ticker,direction:'UNKNOWN',agreeingSources:0,
   allocationFraction:0,observedSources:0,updatedAt:new Date(now).toISOString()};
 const ref=numeric(referencePrice);
 if(!symbols.has(symbol)||!pOk(ref)||typeof ticker!=='string'||
    !ticker.startsWith('KX'+symbol+'15M-'))return invalid;
 const settled=await Promise.allSettled(venueNames.map(async source=>{
   const response=await fetcher(quoteUrl(source,symbol),{method:'GET',redirect:'error',
     signal:typeof AbortSignal==='undefined'?undefined:AbortSignal.timeout(2500)});
   if(!response?.ok)throw Error('Spot quote unavailable');
   const parsed=readBidAsk(source,await response.json());
   if(!parsed)throw Error('Invalid quote');
   const age=now-parsed.timestamp;
   if(parsed.timestamp!=null&&(!Number.isFinite(age)||age< -10000||age>30000))
     throw Error('Stale provider quote');
   return {source,price:parsed.price};
 }));
 const rows=settled.filter(r=>r.status==='fulfilled').map(r=>r.value);
 if(rows.length<5)return {...invalid,observedSources:rows.length};
 const sorted=rows.map(x=>x.price).sort((a,b)=>a-b);
 const median=sorted[Math.floor(sorted.length/2)];
 const sane=rows.filter(x=>Math.abs(x.price/median-1)<=.01);
 if(sane.length<5)return {...invalid,observedSources:sane.length};
 const bound=minMovePct/100;
 const up=sane.filter(x=>x.price/ref-1>bound).length;
 const down=sane.filter(x=>x.price/ref-1< -bound).length;
 const agree=Math.max(up,down),direction=agree>=5?(up>down?'UP':'DOWN'):'UNKNOWN';
 return {symbol,marketTicker:ticker,direction,
   agreeingSources:direction==='UNKNOWN'?0:agree,observedSources:sane.length,
   allocationFraction:agree>=7?.4:agree===6?.3:agree===5?.2:0,
   updatedAt:new Date(now).toISOString(),
   source:'SEVEN_LIVE_SPOT_BID_ASK_LEVELS_VS_OFFICIAL_KALSHI_STRIKE',
   referencePrice:ref,spotMedianPrice:median,
   observations:sane.map(x=>({source:x.source,price:x.price}))};
}
