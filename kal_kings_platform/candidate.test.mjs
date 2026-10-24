import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatedMatches} from './index.mjs';
const now=Date.parse('2026-10-24T18:00:00Z');
const k=[{id:'K',yesAsk:.44,noAsk:.58,yesDepth:100,updatedAt:new Date(now-1000).toISOString()}];
const d=[{id:'D',event:'Team A at Team B',updatedAt:new Date(now-1000).toISOString(),outcomes:[{selection:'Team B',american:-110}]}];
const pairs=[{id:'P',kalshi_ticker:'K',dk_event_id:'D',dk_selection:'Team B',kalshi_side:'yes',reviewed_at:new Date(now-1000).toISOString(),reviewed_rule_digest:'sha256:'+'a'.repeat(64)}];
test('verified, positive match can be quoted before funding but never reported funded',()=>{
 const out=evaluatedMatches(pairs,k,d,0,now,0);
 assert.equal(out.length,1);
 assert.equal(out[0].funded,false);
 assert.ok(out[0].minimumProfit>0);
 assert.equal(out[0].executableArbitrage,false);
 assert.ok(out[0].monteCarlo);
});
test('different or stale rules reject trade recommendation',()=>{
 const invalid=[{...pairs[0],reviewed_at:new Date(now-8*86400000).toISOString()}];
 assert.equal(evaluatedMatches(invalid,k,d,100,now,100).length,0);
});
