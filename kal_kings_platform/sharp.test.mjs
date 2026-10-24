import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSharpOdds, sharpFeedOdds} from './sharp.mjs';
const fresh='2026-10-24T18:31:05Z';
test('SharpAPI selection rows group into one sportsbook moneyline without inventing an execution permission',()=>{
 const rows=[
  {id:'1',event:'Steelers @ Colts',market:'moneyline',sport:'nfl',start:'2026-10-25T20:00:00Z',updatedAt:fresh,observedAt:fresh,outcomes:[{selection:'Steelers',american:-105}]},
  {id:'2',event:'Steelers @ Colts',market:'moneyline',sport:'nfl',start:'2026-10-25T20:00:00Z',updatedAt:fresh,observedAt:fresh,outcomes:[{selection:'Colts',american:+115}]},
  {id:'3',event:'Steelers @ Colts',market:'1st_half_moneyline',sport:'nfl',start:'2026-10-25T20:00:00Z',updatedAt:fresh,observedAt:fresh,outcomes:[{selection:'Colts',american:+150}]}
 ];
 const result=normalizeSharpOdds({events:rows,provider:'SharpAPI'},fresh);
 assert.equal(result.events.length,2);
 const full=result.events.find(x=>x.market==='moneyline');
 assert.equal(full.outcomes.length,2);
 assert.deepEqual(full.outcomes.map(x=>x.american),[-105,115]);
 assert.equal(full.sportsbook,'draftkings');
 assert.equal(full.wagerExecutionAvailable,false);
 assert.equal(full.updatedAt,fresh);
});
test('SharpAPI failing upstream never creates fabricated zero-priced markets',async()=>{
 const result=await sharpFeedOdds({fetcher:async()=>Response.json({error:'no feed'}, {status:503})});
 assert.equal(result.events.length,0);assert.ok(result.issues.length);
});
test('SharpAPI rejects non sports and corrupt odds',()=>{
 const result=normalizeSharpOdds({events:[{id:'a',event:'Bad match',market:'moneyline',sport:'nfl',outcomes:[{selection:'X',american:20}]},{id:'b',event:'crypto BTC',market:'moneyline',sport:'crypto',outcomes:[{selection:'BTC',american:150}]}]});
 assert.equal(result.events.length,0);
});
