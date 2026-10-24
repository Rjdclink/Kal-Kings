import test from 'node:test';import assert from 'node:assert/strict';
import {makeHandler,normalize} from './index.mjs';
const row={id:'1',event_id:'fixture',sportsbook:'draftkings',home_team:'Home',away_team:'Away',market_type:'moneyline',selection:'Home',odds_american:120,timestamp:'2026-10-24T00:00:00Z'};
test('normalizes display fields, preserves timestamps and delay without recommendations',()=>{
 const d=normalize({data:[row,{...row,is_active:false},{...row,sportsbook:'other'}],meta:{tier:{data_delay_seconds:60}}});
 assert.equal(d.events.length,1);assert.equal(d.events[0].updatedAt,row.timestamp);assert.equal(d.dataDelaySeconds,60);assert.ok(!JSON.stringify(d).includes('deep_link'));
});
test('fixed read-only endpoint caches requests and keeps credentials server-side',async()=>{
 let calls=0;const handler=makeHandler({SHARPAPI_KEY:'test-secret'},async(url,opts)=>{calls++;assert.equal(new URL(url).hostname,'api.sharpapi.io');assert.equal(opts.method,'GET');assert.equal(opts.headers['X-API-Key'],'test-secret');return Response.json({data:[row]});});
 for(let i=0;i<2;i++){const r=await handler(new Request('https://example.test/'));assert.equal(r.status,200);assert.ok(!(await r.text()).includes('test-secret'));}
 assert.equal(calls,1);assert.equal((await handler(new Request('https://example.test/',{method:'POST'}))).status,405);
});
test('authentication errors are redacted and cached',async()=>{
 let calls=0;const h=makeHandler({SHARPAPI_KEY:'private'},async()=>{calls++;return new Response('private',{status:401});});
 for(let i=0;i<2;i++){const r=await h(new Request('https://example.test/'));assert.equal(r.status,502);assert.deepEqual((await r.json()).issues,['SharpAPI authentication rejected']);}assert.equal(calls,1);
});
