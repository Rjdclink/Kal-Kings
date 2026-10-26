import test from 'node:test';import assert from 'node:assert/strict';
import {makeSoloRunner, isNeonSoloTrigger, activeScanSlot} from './solo_runner.mjs';
const now=Date.parse('2026-10-24T20:00:00Z');
const q={id:'KXNFLGAME-26TEST-YES',event:'Test',yesAsk:.43,noAsk:.51,yesDepth:10,noDepth:10,observedAt:new Date(now).toISOString()};
const runInput={invocationId:'run1',scheduledAt:new Date(now).toISOString()};
function fixture(override={}){
 const tables={orders:new Map(),runs:new Set()}; const calls=[];
 const deps={
  fetchAccount:async()=>({balance:100}),fetchQuotes:async()=>[q],fetchMarket:async()=>({...q}),
  quantRiskGate:async({quote})=>({accepted:true,candidate:{source:'KALSHI_ONLY',marketTicker:quote.id,count:1,yesPrice:.43,noPrice:.51,requiredDollars:.99,netProfitDollars:.01}}),
  sql:async(query,params=[])=>{
    if(query.includes('FROM kal_kings_solo_orders')&&query.includes('status IN'))return [];
    if(query.includes('INSERT INTO kal_kings_solo_runs')){if(tables.runs.has(params[0]))return [];tables.runs.add(params[0]);return [{invocation_id:params[0]}];}
    if(query.includes('INSERT INTO kal_kings_solo_orders')){if(tables.orders.has(params[0]))return [];tables.orders.set(params[0],{ticker:params[0],status:'SUBMITTING'});return [{ticker:params[0]}];}
    if(query.includes('UPDATE kal_kings_solo_orders'))return [{ticker:params[0]}];
    if(query.includes('UPDATE kal_kings_solo_runs'))return [];
    throw Error('Unexpected query: '+query);
  },
  submit:async o=>{calls.push(o);return {order_id:'x'+calls.length,fill_count:o.count};},
  createId:(()=>{let n=0;return()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`})(),
  now:()=>now,...override,
 };
 return {run:makeSoloRunner(deps),calls,tables};
}
test('Neon schedule trigger authenticated by matched protected proxy header',()=>{
 const body={version:1,invocation_id:'nonce',trigger:{type:'schedule',name:'kal-kings-solo-minute'},data:{scheduled_at:new Date(now).toISOString()}};
 assert.equal(isNeonSoloTrigger({'x-neon-trigger-invocation-id':'nonce'},body,now),true);
 assert.equal(isNeonSoloTrigger({},body,now),false);
 assert.equal(isNeonSoloTrigger({'x-neon-trigger-invocation-id':'wrong'},body,now),false);
 assert.equal(isNeonSoloTrigger({'x-neon-trigger-invocation-id':'nonce'}, {...body,trigger:{...body.trigger,name:'other'}},now),false);
});
test('Kalshi-only timer executes both legs without a DraftKings ticket',async()=>{
 const f=fixture();const result=await f.run(runInput);
 assert.equal(result.status,'HEDGED');assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].side,'bid');assert.equal(f.calls[1].side,'ask');
});
test('zero bankroll and no qualifying spread never place orders',async()=>{
 const a=fixture({fetchAccount:async()=>({balance:.05})});assert.equal((await a.run(runInput)).status,'NO_QUALIFYING_KALSHI_TRADE');assert.equal(a.calls.length,0);
 const b=fixture({fetchQuotes:async()=>[{...q,noAsk:.6}]});assert.equal((await b.run(runInput)).status,'NO_QUALIFYING_KALSHI_TRADE');assert.equal(b.calls.length,0);
});
test('a partial one-leg outcome freezes future autonomous attempts',async()=>{
 const f=fixture({submit:async o=>o.side==='bid'?{order_id:'yes',fill_count:o.count}:{order_id:'no',fill_count:'0.00'}});
 const result=await f.run(runInput);assert.equal(result.status,'UNHEDGED');
});

test('Kalshi solo entry checks position lifecycle first and reuses exchange free cash',async()=>{
 let runs=0;
 const f=fixture({monitorPositions:async()=>{runs++;return {freeCash:100,status:'MONITORED'};}});
 const out=await f.run(runInput);
 assert.equal(out.status,'HEDGED');assert.equal(runs,1);
});
test('an unreconciled position blocks new entries even when quote edge is positive',async()=>{
 const f=fixture({monitorPositions:async()=>({status:'MONITORED',freeCash:100,pendingReview:1})});
 const out=await f.run(runInput);assert.equal(out.status,'HALTED_PENDING_RECONCILIATION');assert.equal(f.calls.length,0);
});

test('worker records failure stage rather than pretending market has no opportunities',async()=>{
 const f=fixture({monitorPositions:async()=>{throw Error('secret internal detail')}});
 const result=await f.run(runInput);
 assert.equal(result.status,'SCANNER_UNAVAILABLE_MONITOR');
 assert.ok(!JSON.stringify(result).includes('secret internal detail'));
});

test('verified free cash from position monitor avoids redundant authenticated account fetch',async()=>{
 const f=fixture({monitorPositions:async()=>({status:'MONITORED',freeCash:100,pendingReview:0}),
  fetchAccount:async()=>{throw Error('second account query blocked by rate limit')}});
 const result=await f.run(runInput);
 assert.equal(result.status,'HEDGED');
 assert.equal(f.calls.length,2);
});

test('independent predictive scanner runs even when no YES/NO arbitrage qualifies',async()=>{
 let predictiveRuns=0;
 const f=fixture({fetchQuotes:async()=>[{...q,noAsk:.7}],scanPredictive:async()=>{predictiveRuns++;}});
 const result=await f.run(runInput);
 assert.equal(result.status,'NO_QUALIFYING_KALSHI_TRADE');
 assert.equal(predictiveRuns,1);
 assert.equal(f.calls.length,0);
});
test('predictive provider failure cannot create unsafe trades',async()=>{
 const f=fixture({fetchQuotes:async()=>[{...q,noAsk:.7}],scanPredictive:async()=>{throw Error('provider down')}});
 const result=await f.run(runInput);
 assert.equal(result.status,'NO_QUALIFYING_KALSHI_TRADE');
 assert.equal(f.calls.length,0);
});

test('directional opportunity executes independently when no same-market arbitrage exists',async()=>{
 let count=0,monitored=0;
 const f=fixture({fetchQuotes:async()=>[{...q,noAsk:.65}],
   fetchAccount:async()=>({status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}),
   scanPredictive:async()=>({ideas:[{id:'eligible-live-game'}]}),
   monitorDirectional:async()=>{monitored++;return {pendingReview:0}},
   executeDirectional:async({ideas,account})=>{count++;assert.equal(account.balance,15);assert.equal(ideas.length,1);return {status:'FILLED',ticker:'KXGAME'};}
 });
 const result=await f.run(runInput);
 assert.equal(result.status,'DIRECTIONAL_FILLED');assert.equal(count,1);assert.equal(monitored,1);
 assert.equal(f.calls.length,0);
});
test('uncertain directional execution ends the cycle without any paired-arbitrage attempt',async()=>{
 const f=fixture({scanPredictive:async()=>({ideas:[{id:'x'}]}),
  executeDirectional:async()=>({status:'UNCERTAIN',ticker:'KXGAME'})});
 const result=await f.run(runInput);
 assert.equal(result.status,'DIRECTIONAL_UNCERTAIN');assert.equal(f.calls.length,0);
});

test('worker records why it found no opportunity, including broad market survey breadth',async()=>{
 let last=null;
 const f=fixture({
   fetchQuotes:async()=>[{...q,noAsk:.65}],
   scanPredictive:async()=>({ideas:[],cryptoSignals:6,sportsSignals:0,universeScanned:500}),
   recordScan:async x=>{last=x;}
 });
 const result=await f.run(runInput);
 assert.equal(result.status,'NO_QUALIFYING_KALSHI_TRADE');
 assert.equal(last.status,'NO_QUALIFYING_KALSHI_TRADE');
 assert.equal(last.universeScanned,500);
});

test('an unavailable legacy eight-series sports feed cannot stop independently verified value trading',async()=>{
 let scanned=0,approved=0;
 const f=fixture({fetchQuotes:async()=>{throw Error('sports market provider timeout')},
    scanPredictive:async()=>{scanned++;return {ideas:[{id:'valid-total'}]};},
    fetchAccount:async()=>({status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}),
    executeDirectional:async()=>{approved++;return {status:'FILLED',ticker:'KXNFLTOTAL-TEST'};}});
 const out=await f.run(runInput);
 assert.equal(out.status,'DIRECTIONAL_FILLED');
 assert.equal(scanned,1);assert.equal(approved,1);
});
test('missing legacy quotes never produce fabricated two-leg orders',async()=>{
 const f=fixture({fetchQuotes:async()=>{throw Error('timeout')},
    scanPredictive:async()=>({ideas:[]})});
 const out=await f.run(runInput);
 assert.equal(out.status,'NO_VALID_LEGACY_QUOTES');
 assert.equal(f.calls.length,0);
});

test('five-second UI scan slots are stable for duplicate clients and change at boundaries',()=>{const one=activeScanSlot(Date.parse('2026-10-26T14:00:04Z'));const same=activeScanSlot(Date.parse('2026-10-26T14:00:04.999Z'));const next=activeScanSlot(Date.parse('2026-10-26T14:00:05Z'));assert.deepEqual(one,same);assert.notEqual(one.invocationId,next.invocationId);assert.equal(new Date(one.scheduledAt).toISOString(),'2026-10-26T14:00:00.000Z')});

test('a simultaneous five-second scan cannot start another cash-consuming worker',async()=>{let placed=0;const f=fixture({acquireScanLease:async()=>false,submit:async()=>{placed++;return{fill_count:'1.00'}}});const result=await f.run(runInput);assert.equal(result.status,'SCANNER_BUSY');assert.equal(placed,0)});
test('an acquired scan lease is released after completion',async()=>{let released=0;const f=fixture({acquireScanLease:async()=>true,releaseScanLease:async()=>{released++}});await f.run(runInput);assert.equal(released,1)});

test('confirmed profitable directional entry does not wait for unused legacy quote discovery',async()=>{
 let legacyCalls=0;
 const f=fixture({
   fetchQuotes:async()=>{legacyCalls++;throw Error('legacy feed should not run before directional trade');},
   monitorPositions:async()=>({status:'MONITORED',freeCash:15,holdings:[],positionsComplete:true,pendingReview:0}),
   fetchAccount:async()=>({status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}),
   scanPredictive:async()=>({ideas:[{id:'current-approved-crypto'}],cryptoSignals:1}),
   executeDirectional:async()=>({status:'FILLED',ticker:'KXBTC15M-LIVE'})});
 const result=await f.run(runInput);
 assert.equal(result.status,'DIRECTIONAL_FILLED');
 assert.equal(legacyCalls,0);
});
