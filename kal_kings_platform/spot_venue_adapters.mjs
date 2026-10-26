/** Public OHLCV feeds for independently operated crypto venues. */
const symbols=new Set(['BTC','ETH','SOL','XRP','DOGE','ADA']);
const timestamp=value=>{const t=Number(value);return Number.isFinite(t)?Math.floor(t>1e12?t/1000:t):NaN};
export async function additionalSpotCandles(fetcher,symbol,venue){
 if(!symbols.has(symbol)||!['gemini','okx','kucoin','bitfinex'].includes(venue))return [];
 if(typeof fetcher!=='function')return [];
 const urls={
  gemini:`https://api.gemini.com/v2/candles/${symbol.toLowerCase()}usd/1m`,
  okx:`https://www.okx.com/api/v5/market/candles?instId=${symbol}-USDT&bar=5m&limit=80`,
  kucoin:`https://api.kucoin.com/api/v1/market/candles?symbol=${symbol}-USDT&type=5min`,
  bitfinex:`https://api-pub.bitfinex.com/v2/candles/trade:5m:t${symbol}USD/hist?limit=80`
 };
 const response=await fetcher(urls[venue],{method:'GET',
  signal:typeof AbortSignal==='undefined'?undefined:AbortSignal.timeout(7000),redirect:'error'});
 if(!response?.ok)throw Error('Venue candle feed unavailable');
 const data=await response.json();
 if(venue==='okx'&&data.code!=='0')throw Error('OKX candle error');
 if(venue==='kucoin'&&data.code!=='200000')throw Error('KuCoin candle error');
 const rows=['okx','kucoin'].includes(venue)?data.data:data;
 if(!Array.isArray(rows))throw Error('Malformed venue candle data');
 if(venue==='gemini'){
  // Native Gemini 5m bars may lag by ten minutes. Aggregate its more
  // current 1m OHLCV data into 5m buckets without inventing any bars.
  const minutes=rows.slice(0,280).filter(Array.isArray).map(row=>({
   time:timestamp(row[0]),open:Number(row[1]),high:Number(row[2]),
   low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])||0
  })).filter(x=>Number.isFinite(x.time)&&x.open>0&&x.close>0)
    .sort((a,b)=>a.time-b.time);
  const buckets=new Map();
  for(const minute of minutes){
   const bucketTime=Math.floor(minute.time/300)*300;
   const prev=buckets.get(bucketTime);
   if(!prev){
     buckets.set(bucketTime,{time:bucketTime,open:minute.open,close:minute.close,
       high:minute.high,low:minute.low,volume:minute.volume,
       lastSampleTime:minute.time});
   }else{
     prev.close=minute.close;
     prev.high=Math.max(prev.high,minute.high);
     prev.low=Math.min(prev.low,minute.low);
     prev.volume+=minute.volume;
     prev.lastSampleTime=minute.time;
   }
  }
  return [...buckets.values()].sort((a,b)=>a.time-b.time);
 }
 return rows.slice(0,90).filter(Array.isArray).map(row=>{
  const i=['gemini','okx'].includes(venue)?4:2;
  return {time:timestamp(row[0]),open:Number(row[1]),close:Number(row[i]),
    high:Number(row[venue==='gemini'||venue==='okx'?2:3]),
    low:Number(row[venue==='gemini'?3:venue==='kucoin'?4:4]),
    volume:Number(row[5])};
 }).filter(x=>Number.isFinite(x.time)&&x.open>0&&x.close>0);
}
