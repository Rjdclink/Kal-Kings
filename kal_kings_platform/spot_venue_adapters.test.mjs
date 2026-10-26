import test from 'node:test';
import assert from 'node:assert/strict';
import {additionalSpotCandles} from './spot_venue_adapters.mjs';
test('source validator rejects unknown exchanges',async()=>assert.deepEqual(await additionalSpotCandles(null,'BTC','unknown'),[]));

test('venue candles parse returned timestamp and opening price',async()=>{const x=await additionalSpotCandles(async()=>({ok:true,json:async()=>[[1793010000000,100,110,90,101,1]]}),'BTC','gemini');assert.equal(x[0].time,1793010000);assert.equal(x[0].open,100);assert.equal(x[0].close,101)});

test('OKX and KuCoin normalize documented candle columns',async()=>{for(const [venue,payload] of [['okx',{code:'0',data:[['1793010000000','100','110','90','101','3']]}],['kucoin',{code:'200000',data:[['1793010000','100','101','110','90','3']]}]]){const data=await additionalSpotCandles(async()=>({ok:true,json:async()=>payload}),'BTC',venue);assert.equal(data.length,1);assert.equal(data[0].open,100);assert.equal(data[0].close,101)}});

test('Gemini current one-minute candles roll into four five-minute bars without using stale native five-minute data',async()=>{
 const t=Date.parse('2026-10-26T16:00:00Z')/1000;
 const minutes=Array.from({length:20},(_,i)=>[(t+60*i)*1000,100+i,102+i,99+i,101+i,1]).reverse();
 let source='';
 const rows=await additionalSpotCandles(async url=>{source=url;return{ok:true,json:async()=>minutes}},'BTC','gemini');
 assert.ok(source.endsWith('/1m'));
 assert.equal(rows.length,4);
 assert.equal(rows[0].time,t);
 assert.equal(rows[0].open,100);
 assert.equal(rows[0].close,105);
 assert.equal(rows[3].lastSampleTime,t+19*60);
 assert.equal(rows[3].close,120);
});

test('OKX OHLC low is source field 3, not field 4 close price',async()=>{const x=await additionalSpotCandles(async()=>({ok:true,json:async()=>({code:'0',data:[['1793010000000','100','120','80','110','3']]})}),'BTC','okx');assert.equal(x[0].high,120);assert.equal(x[0].low,80);assert.equal(x[0].close,110)});
