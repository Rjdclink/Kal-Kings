import test from 'node:test';import assert from 'node:assert/strict';
import {makeSoloRunner, isNeonSoloTrigger} from './solo_runner.mjs';
const now=Date.parse('2026-10-24T20:00:00Z');
const q={id:'KXNFLGAME-26TEST-YES',event:'Test',yesAsk:.43,noAsk:.51,yesDepth:10,noDepth:10,observedAt:new Date(now).toISOString()};
const runInput={invocationId:'run1',scheduledAt:new Date(now).toISOString()};
function fixture(override={}){
 const tables={orders:new Map(),runs:new Set()}; const calls=[];
 const deps={
  fetchAccount:async()=>({balance:100}),fetchQuotes:async()=>[q],fetchMarket:async()=>({...q}),
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
