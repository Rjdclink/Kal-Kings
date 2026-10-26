import test from 'node:test';
import assert from 'node:assert/strict';
import {additionalSpotCandles} from './spot_venue_adapters.mjs';
test('source validator rejects unknown exchanges',async()=>assert.deepEqual(await additionalSpotCandles(null,'BTC','unknown'),[]));

test('venue candles parse returned timestamp and opening price',async()=>{const x=await additionalSpotCandles(async()=>({ok:true,json:async()=>[[1793010000000,100,110,90,101,1]]}),'BTC','gemini');assert.equal(x[0].time,1793010000);assert.equal(x[0].open,100);assert.equal(x[0].close,101)});

test('OKX and KuCoin normalize documented candle columns',async()=>{for(const [venue,payload] of [['okx',{code:'0',data:[['1793010000000','100','110','90','101','3']]}],['kucoin',{code:'200000',data:[['1793010000','100','101','110','90','3']]}]]){const data=await additionalSpotCandles(async()=>({ok:true,json:async()=>payload}),'BTC',venue);assert.equal(data.length,1);assert.equal(data[0].open,100);assert.equal(data[0].close,101)}});
