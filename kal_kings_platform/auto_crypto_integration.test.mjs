import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCryptoSignals} from './predictive_feeds.mjs';
import {selectCryptoIdea} from './crypto_candidate.mjs';
import {makeDirectionalRunner} from './directional_runner.mjs';
const now=Date.parse('2026-10-26T14:13:00Z');
const start=Date.parse('2026-10-26T11:00:00Z')/1000;
const candles=Array.from({length:39},(_,i)=>{const t=start+i*300;
 const p=t>=Date.parse('2026-10-26T14:00:00Z')/1000?100+(t-Date.parse('2026-10-26T14:00:00Z')/1000)/300*2:95+(i*.13);
 return{t,open:p,close:p+1,hi:p+2,lo:p-1,vol:8}});
const market={ticker:'KXBTC15M-26OCT261015-15',status:'active',yes_ask_dollars:'0.7000',
 no_ask_dollars:'0.3100',yes_ask_size_fp:'40.00',no_ask_size_fp:'40.00',
 close_time:new Date(now+120000).toISOString(),
 rules_primary:"If the simple average of the sixty seconds of CF Benchmarks' BRTI before 10:15 AM EDT is at least the simple average of the preceding sixty seconds, then the market resolves to Yes."};
const api=async url=>{
 let data;
 if(url.includes('coinbase.com'))data=candles.map(x=>[x.t,x.lo,x.hi,x.open,x.close,x.vol]);
 else if(url.includes('kraken.com'))data={error:[],result:{XBTUSD:candles.map(x=>[x.t,x.open,x.hi,x.lo,x.close,100,x.vol,1])}};
 else if(url.includes('bitstamp.net'))data={data:{ohlc:candles.map(x=>({timestamp:x.t,open:x.open,close:x.close,high:x.hi,low:x.lo,volume:x.vol}))}};
 else if(url.includes('api.gemini.com'))data=candles.map(x=>[x.t*1000,x.open,x.hi,x.lo,x.close,x.vol]);
 else if(url.includes('www.okx.com'))data={code:'0',data:candles.map(x=>[x.t*1000,x.open,x.hi,x.lo,x.close,x.vol])};
 else if(url.includes('api.kucoin.com'))data={code:'200000',data:candles.map(x=>[x.t,x.open,x.close,x.hi,x.lo,x.vol])};
 else if(url.includes('api-pub.bitfinex.com'))data=candles.map(x=>[x.t*1000,x.open,x.close,x.hi,x.lo,x.vol]);
 else if(url.includes('kalshi.com'))data={markets:[market]};
 else throw Error('Unrecognized source');
 return {ok:true,json:async()=>data};
};
test('seven source consensus reaches real simulated market candidate and FOK submission',async()=>{
 const observations=await fetchCryptoSignals({fetcher:api,now,symbols:['BTC']});
 assert.equal(observations.length,1);
 assert.equal(observations[0].agreeingSources,7);
 assert.equal(observations[0].allocationFraction,.4);
 const idea=selectCryptoIdea(observations[0],{now});
 assert.equal(idea?.side,'yes');
 let attempts=0;
 const sql=async(q,args=[])=>q.includes('INSERT INTO kal_kings_directional_orders')?[{ticker:args[0]}]:[];
 const runner=makeDirectionalRunner({sql,
  fetchMarket:async ticker=>({id:ticker,ticker,status:'active',rulesPrimary:market.rules_primary,
    closeTime:market.close_time,observedAt:new Date(now).toISOString()}),
  fetchOrderbook:async()=>({orderbook_fp:{yes_dollars:[['0.6000','40.00']],no_dollars:[['0.3000','40.00']]} }),
  fetchFeeSchedule:async()=>({feeType:'quadratic',feeMultiplier:1}),
  fetchFinalConsensus:async()=>({...observations[0],updatedAt:new Date(now).toISOString()}),
  submit:async order=>{attempts++;return{order_id:'trade',fill_count:order.count}},
  createId:()=> '123e4567-e89b-42d3-a456-426614174000',now:()=>now});
 const result=await runner({ideas:[idea],account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(result.status,'FILLED');
 assert.equal(attempts,1);
 assert.ok(result.estimatedMaxDebitDollars<=6);
});
