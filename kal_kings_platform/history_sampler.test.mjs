import test from 'node:test';
import assert from 'node:assert/strict';
import {selectHistorySamples} from './history_sampler.mjs';
const now=Date.parse('2026-10-24T20:30:00Z');
const valid=(index,time=now)=>({id:'KXTEST-'+String(index).padStart(2,'0'),yesBid:.4,yesAsk:.45,yesDepth:index+1,noDepth:index+2,observedAt:new Date(time).toISOString()});
test('history sampler selects fresh unique quotes with a strict bounded batch',()=>{
 const rows=[...Array.from({length:80},(_,i)=>valid(i)),valid(2),valid(900,now-5000)];
 const selected=selectHistorySamples(rows,now,12);
 assert.equal(selected.length,12);
 assert.equal(new Set(selected.map(x=>x.id)).size,selected.length);
 assert.ok(selected.some(x=>x.id===valid(79).id));
 assert.ok(selected.every(x=>x.observedAt===new Date(now).toISOString()));
});
test('sampler rotates part of the watchlist instead of repeating only high-liquidity quotes',()=>{
 const rows=Array.from({length:80},(_,i)=>valid(i));
 const a=selectHistorySamples(rows,now,12).map(x=>x.id);
 const b=selectHistorySamples(rows,now+60_000,12).map(x=>x.id);
 assert.notDeepEqual(a,b);
});
test('sampler refuses malformed or future prices and never invents quote data',()=>{
 const rows=[valid(1),{...valid(2),yesBid:NaN},valid(3,now+4000),valid(4,now-8000)];
 const selected=selectHistorySamples(rows,now,10);
 assert.deepEqual(selected.map(x=>x.id),[valid(1).id]);
});
test('historical quotes do not require no-side depth when the YES bid and ask are verifiable',()=>{
 const q={...valid(42),noDepth:null,yesDepth:null,yesBidDepth:null};
 const sample=selectHistorySamples([q],now,12);
 assert.equal(sample.length,1);
 assert.equal(sample[0].id,q.id);
});
