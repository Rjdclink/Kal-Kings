import test from 'node:test';
import assert from 'node:assert/strict';
import {additionalSpotCandles} from './spot_venue_adapters.mjs';
test('source validator rejects unknown exchanges',async()=>assert.deepEqual(await additionalSpotCandles(null,'BTC','unknown'),[]));
