import test from 'node:test';
import assert from 'node:assert/strict';
import {additionalSpotCandles} from './spot_venue_adapters.mjs';
test('source validator rejects unknown exchanges',async()=>assert.deepEqual(await additionalSpotCandles(null,'BTC','unknown'),[]));

test('venue candles parse returned timestamp and opening price',async()=>{const x=await additionalSpotCandles(async()=>({ok:true,json:async()=>[[1793010000000,100,110,90,101,1]]}),'BTC','gemini');assert.equal(x[0].time,1793010000);assert.equal(x[0].open,100);assert.equal(x[0].close,101)});
