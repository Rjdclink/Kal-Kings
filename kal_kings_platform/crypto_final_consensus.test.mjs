import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchFinalCryptoConsensus} from './crypto_final_consensus.mjs';
const now=Date.parse('2026-10-26T14:30:00Z');
const quote=p=>({bid:String(p-.01),ask:String(p+.01)});
const data={
 coinbase:p=>({...quote(p),price:String(p),time:new Date(now-100).toISOString()}),
 kraken:p=>({error:[],result:{XXBTZUSD:{a:[String(p+.01)],b:[String(p-.01)]}}}),
 bitstamp:p=>({...quote(p),timestamp:String(now/1000)}),
 gemini:p=>({...quote(p),last:String(p)}),
 okx:p=>({code:'0',data:[{bidPx:String(p-.01),askPx:String(p+.01),last:String(p),ts:String(now-100)}]}),
 kucoin:p=>({code:'200000',data:{bestBid:String(p-.01),bestAsk:String(p+.01),time:now-100}}),
 bitfinex:p=>[p-.01,1,p+.01,1,0,0,p,0,0,0,0]
};
function mock(prices,delay=0){
 return async url=>{
  const venue=url.includes('coinbase.com')?'coinbase':
   url.includes('kraken.com')?'kraken':url.includes('bitstamp.net')?'bitstamp':
   url.includes('gemini.com')?'gemini':url.includes('okx.com')?'okx':
   url.includes('kucoin.com')?'kucoin':'bitfinex';
  return{ok:true,json:async()=>data[venue](prices[venue])};
 };
}
test('fresh seven-price consensus confirms official Kalshi target UP and 40 percent allocation',async()=>{
 const prices=Object.fromEntries(Object.keys(data).map(k=>[k,101]));
 const x=await fetchFinalCryptoConsensus({fetcher:mock(prices),symbol:'BTC',
   ticker:'KXBTC15M-TEST',referencePrice:100,now});
 assert.equal(x.direction,'UP');assert.equal(x.agreeingSources,7);
 assert.equal(x.allocationFraction,.4);assert.equal(x.marketTicker,'KXBTC15M-TEST');
});
test('five down seven-up mixed votes approve 20 percent only when five agree',async()=>{
 const prices={coinbase:99,kraken:99,bitstamp:99,gemini:99,okx:99,kucoin:101,bitfinex:101};
 const a=await fetchFinalCryptoConsensus({fetcher:mock(prices),symbol:'BTC',
   ticker:'KXBTC15M-TEST',referencePrice:100,now});
 assert.equal(a.direction,'DOWN');assert.equal(a.agreeingSources,5);
 assert.equal(a.allocationFraction,.2);
});
test('stale venue timestamp, duplicates or too few quotes never produce an executable majority',async()=>{
 const prices=Object.fromEntries(Object.keys(data).map(k=>[k,101]));
 const api=async url=>{
  if(!url.includes('coinbase.com')&&!url.includes('kraken.com')&&
    !url.includes('bitstamp.net'))throw Error('Unavailable');
  return mock(prices)(url);
 };
 const a=await fetchFinalCryptoConsensus({fetcher:api,symbol:'BTC',
   ticker:'KXBTC15M-TEST',referencePrice:100,now});
 assert.equal(a.direction,'UNKNOWN');assert.equal(a.allocationFraction,0);
 const stale=await fetchFinalCryptoConsensus({fetcher:async url=>{
  const r=await mock(prices)(url);
  if(url.includes('coinbase.com'))return {ok:true,json:async()=>({...data.coinbase(101),
    time:new Date(now-45000).toISOString()})};
  return r;
 },symbol:'BTC',ticker:'KXBTC15M-TEST',referencePrice:100,now});
 assert.equal(stale.agreeingSources,6);
});
