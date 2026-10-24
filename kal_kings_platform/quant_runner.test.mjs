import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSoloRunner} from './solo_runner.mjs';
const NOW=Date.parse('2026-10-24T20:30:00Z');
const q={id:'KXFOOTBALL-2026-CHI',event:'Example',yesAsk:.34,noAsk:.37,
 yesDepth:9,noDepth:9,observedAt:new Date(NOW).toISOString()};
function make(quantRiskGate){
 let submits=[],scans=0;const sql=async(sql,args=[])=>{
   if(sql.includes('INSERT INTO kal_kings_solo_runs'))return [{invocation_id:args[0]}];
   if(sql.includes('FROM kal_kings_solo_orders')&&sql.includes('status IN'))return [];
   if(sql.includes('INSERT INTO kal_kings_solo_orders'))return [{ticker:args[0]}];
   if(sql.includes('UPDATE kal_kings_solo_runs')||sql.includes('UPDATE kal_kings_solo_orders'))return [];
   throw Error('Unknown SQL '+sql);
 };
 const runner=makeSoloRunner({fetchAccount:async()=>({balance:100,holdings:[],positionsComplete:true}),
   monitorPositions:async()=>({status:'MONITORED',freeCash:100,holdings:[],positionsComplete:true,pendingReview:0}),
   fetchQuotes:async()=>[q],fetchMarket:async()=>({...q}),
   quantRiskGate:async args=>{scans++;return quantRiskGate(args);},
   sql,submit:async order=>{submits.push(order);return {order_id:'id'+submits.length,fill_count:order.count}},
   createId:(()=>{let i=0;return()=>`00000000-0000-4000-8000-${String(++i).padStart(12,'0')}`})(),now:()=>NOW});
 return {runner:()=>runner({invocationId:'tick',scheduledAt:new Date(NOW).toISOString()}),submits,scans:()=>scans};
}
test('risk engine veto never submits a live order',async()=>{
 const f=make(()=>({accepted:false,reason:'MONTE_CARLO_TAIL_EXCEEDS_BUDGET'}));
 const o=await f.runner();assert.equal(f.scans(),1);assert.equal(f.submits.length,0);
 assert.equal(o.status,'NO_QUANT_APPROVED_KALSHI_TRADE');
});
test('exchange-depth qualified candidate controls real order size/limit and does not depend on DraftKings',async()=>{
 const f=make(()=>({accepted:true,confidence:'EXECUTION_CALIBRATED',candidate:{
   source:'KALSHI_ONLY',marketTicker:q.id,yesPrice:.31,noPrice:.34,count:2,
   netProfitDollars:.5,requiredDollars:1.4}}));
 const o=await f.runner();assert.equal(o.status,'HEDGED');
 assert.equal(f.submits.length,2);assert.equal(f.submits[0].price,'.3100'.replace(/^\./,'0.'));
 assert.equal(f.submits[1].price,'0.6600');assert.equal(f.submits[0].count,'2.00');
});
test('absent risk engine cannot silently bypass Monte Carlo acceptance',async()=>{
 const f=make(()=>undefined); const o=await f.runner();assert.equal(f.submits.length,0);
 assert.equal(o.status,'NO_QUANT_APPROVED_KALSHI_TRADE');
});
test('historical quote snapshots are recorded even when the bankroll is empty; no real orders are submitted', async()=>{
 let observed=0,submitted=0;
 const sql=async(q,args=[])=>{
   if(q.includes('INSERT INTO kal_kings_solo_runs'))return [{invocation_id:args[0]}];
   if(q.includes('FROM kal_kings_solo_orders')&&q.includes('status IN'))return [];
   if(q.includes('UPDATE kal_kings_solo_runs'))return [];
   throw Error('Unexpected query '+q);
 };
 const runner=makeSoloRunner({sql,fetchAccount:async()=>({balance:0}),
   monitorPositions:async()=>({status:'MONITORED',freeCash:0,holdings:[],positionsComplete:true,pendingReview:0}),
   fetchQuotes:async()=>[q],recordSnapshots:async(rows)=>{observed=rows.length;},
   fetchMarket:async()=>{throw Error('Cannot requote unfunded');},
   submit:async()=>{submitted++;throw Error('Must not trade');},
   createId:()=> '123e4567-e89b-42d3-a456-426614174000',now:()=>NOW});
 const result=await runner({invocationId:'sample-empty',scheduledAt:new Date(NOW).toISOString()});
 assert.equal(result.status,'UNFUNDED');assert.equal(observed,1);assert.equal(submitted,0);
});
