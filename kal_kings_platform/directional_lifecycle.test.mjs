import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDirectionalLifecycle} from './directional_lifecycle.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const ticker='KXNFLGAME-26OCT26DALPHI-PHI';
const tracked={ticker,side:'yes',status:'FILLED',contracts:'1',filled_count:'1',entry_price:'.80',
 high_bid:'.80',modeled_probability:'.90',event_key:'NFL:DALPHI'};
const book={orderbook_fp:{yes_dollars:[['0.6300','15.00']],no_dollars:[['0.3600','20.00']]}};
const account={status:'MONITORED',freeCash:10,holdings:[{ticker,position:1}],positionsComplete:true};
function fixture(overrides={}){
 let submissions=[],updates=[];
 const trackedRow=overrides.tracked||tracked;
 const sql=async(q,p=[])=>{
  if(q.includes('SELECT')&&q.includes('kal_kings_directional_orders'))return [trackedRow];
  if(q.includes('UPDATE kal_kings_directional_orders')){updates.push(p);return [{ticker}]}
  return [];
 };
 return {run:makeDirectionalLifecycle({sql,fetchMarket:async()=>({id:ticker,status:'active',observedAt:new Date(now).toISOString()}),
  fetchOrderbook:async()=>book,submit:async x=>{submissions.push(x);return {fill_count:'1.00',order_id:'order123'};},
  fetchSettlements:async()=>[],createId:()=> '123e4567-e89b-42d3-a456-426614174000',now:()=>now,...overrides}),submissions,updates};
}
test('stop loss exit uses only confirmed bot-owned position and a reduce-only sell',async()=>{
 const f=fixture();const result=await f.run(account);
 assert.equal(result.exitsSubmitted,1);
 assert.equal(f.submissions[0].reduce_only,true);
 assert.equal(f.submissions[0].side,'ask');
});
test('unmatched user-held position cannot be liquidated by strategy lifecycle',async()=>{
 const f=fixture();
 const result=await f.run({...account,holdings:[{ticker:'KXOTHER',position:4}]});
 assert.equal(f.submissions.length,0);assert.ok(result.pendingReview>0);
});
test('stale quote never causes automatic reduction',async()=>{
 const f=fixture({fetchMarket:async()=>({id:ticker,status:'active',observedAt:new Date(now-90000).toISOString()})});
 await f.run(account);assert.equal(f.submissions.length,0);
});
test('uncertain sell receipt remains pending and cannot be retried as confirmed closed',async()=>{
 const f=fixture({submit:async()=>{throw Error('network unclear')}});
 const result=await f.run(account);
 assert.ok(result.pendingReview>0);
 assert.equal(result.exitReceiptsConfirmed,0);
});

test('Kalshi NO contracts have negative signed holdings and remain eligible for protective reduction',async()=>{const no={...tracked,side:'no',entry_price:'.80',high_bid:'.80'};const f=fixture({sql:async(q)=>{if(q.includes('SELECT'))return [no];return [{ticker}]}});const result=await f.run({...account,holdings:[{ticker,position:-1}]});assert.equal(result.exitsSubmitted,1);assert.equal(f.submissions[0].side,'bid');assert.equal(f.submissions[0].reduce_only,true)});

test('partially filled directional entry monitors only the confirmed held quantity',async()=>{
 const partial={...tracked,status:'PARTIALLY_FILLED',contracts:'3',filled_count:'1'};
 const f=fixture({tracked:partial});
 const result=await f.run({...account,holdings:[{ticker,position:1}]});
 assert.equal(result.exitsSubmitted,1);
 assert.equal(f.submissions[0].count,1);
});
