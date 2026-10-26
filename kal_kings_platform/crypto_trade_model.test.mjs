import test from 'node:test';
import assert from 'node:assert/strict';
import {runCryptoMonteCarlo} from './crypto_trade_model.mjs';
test('simulations require a grounded beginning reference',()=>assert.equal(runCryptoMonteCarlo({}).status,'UNVERIFIED_REFERENCE'));

test('Monte Carlo estimates strong rise probability from spot-reference spread and finite volatility',()=>{
 const v=runCryptoMonteCarlo({symbol:'BTC',spotPrice:103,referencePrice:100,minutesRemaining:3,
   volatilityPct:.35,observedAt:new Date(Date.parse('2026-10-26T14:00:00Z')-500).toISOString(),
   now:Date.parse('2026-10-26T14:00:00Z'),trials:2500,seed:34});
 assert.equal(v.trials,2500);assert.ok(v.yesProbability>.85);
 assert.ok(v.yesProbability<1);assert.equal(v.status,'ESTIMATED');
});
test('unmatched or stale underlying reference cannot be promoted to a trade forecast',()=>{
 const now=Date.parse('2026-10-26T14:00:00Z');
 const v=runCryptoMonteCarlo({symbol:'BTC',spotPrice:103,referencePrice:100,minutesRemaining:3,
   volatilityPct:.35,observedAt:new Date(now-40000).toISOString(),now});
 assert.equal(v.status,'STALE_RESEARCH');
});
