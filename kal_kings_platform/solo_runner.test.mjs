import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSoloRunner,isNeonSoloTrigger,activeScanSlot} from './solo_runner.mjs';
const now=Date.parse('2026-10-26T20:00:00Z');
const runInput={invocationId:'run1',scheduledAt:new Date(now).toISOString()};
function fixture(override={}){
 const calls=[];let recorded=null,releaseCount=0,executionCount=0;
 const deps={
  fetchAccount:async()=>({status:'VERIFIED',balance:100,holdings:[],positionsComplete:true}),
  fetchQuotes:async()=>{calls.push('legacyQuotes');return [{ticker:'KXNFLGAME-26OCT26DALPHI-PHI'}]},
  sql:async query=>{if(query.includes('INSERT INTO kal_kings_solo_runs'))return [{invocation_id:'run1'}];if(query.includes('SELECT o.ticker FROM kal_kings_solo_orders'))return [];return [];},
  submit:async()=>{calls.push('submit');return {fill_count:1}},
  createId:()=> '123e4567-e89b-42d3-a456-426614174000',
  monitorPositions:async()=>({status:'MONITORED',freeCash:100,holdings:[],positionsComplete:true,pendingReview:0}),
  monitorDirectional:async()=>({pendingReview:0}),
  scanPredictive:async()=>({ideas:[],sportsSignals:0,universeScanned:0,priorityOrder:['TOTAL_ALREADY_OVER','LATE_GAME_LEAD']}),
  executeDirectional:async({ideas})=>{executionCount++;calls.push('execute');return {status:'FILLED',ticker:ideas[0]?.market?.ticker||'KXNFLGAME-TEST',candidateChecks:ideas.length,orderSubmissionAttempts:1,lastCheckedStrategy:ideas[0]?.strategy,lastCheckedTicker:ideas[0]?.market?.ticker}},
  recordScan:async x=>{recorded=x;},
  acquireScanLease:async()=>true,
  releaseScanLease:async()=>{releaseCount++;},
  now:()=>now,
  ...override
 };
 return {run:makeSoloRunner(deps),calls,get recorded(){return recorded},get releaseCount(){return releaseCount},get executionCount(){return executionCount}};
}
const late={strategy:'LATE_GAME_LEAD',sourceVerified:true,marketMatchVerified:true,lateGameVerified:true,updatedAt:new Date(now).toISOString(),market:{ticker:'KXNFLGAME-26OCT26DALPHI-PHI'}};
const total={strategy:'TOTAL_ALREADY_OVER',sourceVerified:true,marketMatchVerified:true,updatedAt:new Date(now).toISOString(),market:{ticker:'KXNFLTOTAL-26OCT26DALPHI-44'}};

test('verified sports candidates reach the execution boundary and report the real result',async()=>{
 const f=fixture({scanPredictive:async()=>({ideas:[total,late],sportsSignals:2,universeScanned:100})});
 const result=await f.run(runInput);
 assert.equal(result.status,'SPORTS_FILLED');assert.equal(f.executionCount,1);
 assert.equal(f.calls.includes('legacyQuotes'),false);
 assert.equal(f.recorded.sportsSignals,2);assert.equal(f.recorded.lastCheckedStrategy,'TOTAL_ALREADY_OVER');
});

test('crypto candidates are filtered before execution',async()=>{
 const f=fixture({scanPredictive:async()=>({ideas:[{strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',market:{ticker:'KXETH15M-26OCT261215-15'}}],sportsSignals:0})});
 const result=await f.run(runInput);
 assert.equal(result.status,'NO_LIVE_SPORTS_CANDIDATES');assert.equal(f.executionCount,0);
 assert.equal(f.calls.includes('legacyQuotes'),false);
});

test('a sports signal without an executable candidate reports the actual qualification blocker',async()=>{
 const f=fixture({scanPredictive:async()=>({ideas:[],sportsSignals:3,universeScanned:500})});
 const result=await f.run(runInput);
 assert.equal(result.status,'SPORTS_SIGNALS_FOUND_NO_EXECUTION_CANDIDATE');
 assert.equal(result.reason,'NO_VERIFIED_MATCHED_SPORTS_CANDIDATE');
 assert.equal(f.recorded.universeScanned,500);
});

test('a qualified sports candidate that fails live execution checks exposes its reason',async()=>{
 const f=fixture({scanPredictive:async()=>({ideas:[late],sportsSignals:1}),executeDirectional:async()=>({status:'NO_VERIFIED_DIRECTIONAL_EDGE',reason:'FEE_SCHEDULE_UNVERIFIED',candidateChecks:1,orderSubmissionAttempts:0,lastCheckedStrategy:'LATE_GAME_LEAD',lastCheckedTicker:late.market.ticker})});
 const result=await f.run(runInput);
 assert.equal(result.status,'SPORTS_SIGNALS_FOUND_NO_EXECUTABLE_ORDER');
 assert.equal(result.reason,'FEE_SCHEDULE_UNVERIFIED');
 assert.equal(f.recorded.sportsExecutionReason,'FEE_SCHEDULE_UNVERIFIED');
});

test('unverified cash prevents all order execution',async()=>{
 const f=fixture({fetchAccount:async()=>({status:'UNAVAILABLE',balance:null}),monitorPositions:async()=>({status:'ACCOUNT_UNAVAILABLE',pendingReview:0}),scanPredictive:async()=>({ideas:[late],sportsSignals:1})});
 const result=await f.run(runInput);
 assert.equal(result.status,'ACCOUNT_UNAVAILABLE');assert.equal(f.executionCount,0);
});

test('an acquired scan lease is released after completion',async()=>{
 const f=fixture();await f.run(runInput);assert.equal(f.releaseCount,1);
});

test('a busy lease prevents any execution',async()=>{
 const f=fixture({acquireScanLease:async()=>false});
 const result=await f.run(runInput);assert.equal(result.status,'SCANNER_BUSY');assert.equal(f.executionCount,0);
});

test('five-second scan slots are stable within a slot and change at the boundary',()=>{
 const a=activeScanSlot(Date.parse('2026-10-26T14:00:04Z'));
 const b=activeScanSlot(Date.parse('2026-10-26T14:00:04.999Z'));
 const c=activeScanSlot(Date.parse('2026-10-26T14:00:05Z'));
 assert.deepEqual(a,b);assert.notEqual(a.invocationId,c.invocationId);
 assert.equal(new Date(a.scheduledAt).toISOString(),'2026-10-26T14:00:00.000Z');
});

test('Neon trigger validation rejects untrusted or stale invocations',()=>{
 const body={version:1,invocation_id:'run-1',trigger:{type:'schedule',name:'kal-kings-solo-minute'},data:{scheduled_at:new Date(now).toISOString()}};
 assert.equal(isNeonSoloTrigger({'x-neon-trigger-invocation-id':'run-1'},body,now),true);
 assert.equal(isNeonSoloTrigger({'x-neon-trigger-invocation-id':'wrong'},body,now),false);
 assert.equal(isNeonSoloTrigger({'x-neon-trigger-invocation-id':'run-1'},body,now+300000),false);
});


test('MONITORED lifecycle account is normalized to VERIFIED execution contract',async()=>{
 let receivedAccount=null;
 const f=fixture({
  monitorPositions:async()=>({status:'MONITORED',freeCash:80,holdings:[],positionsComplete:true,pendingReview:0}),
  scanPredictive:async()=>({ideas:[total],sportsSignals:1,universeScanned:10}),
  executeDirectional:async({account})=>{receivedAccount=account;return {status:'NO_VERIFIED_DIRECTIONAL_EDGE',reason:'TEST_GATE',candidateChecks:1,orderSubmissionAttempts:0};}
 });
 await f.run(runInput);
 assert.deepEqual(receivedAccount,{status:'VERIFIED',balance:80,holdings:[],positionsComplete:true});
});
