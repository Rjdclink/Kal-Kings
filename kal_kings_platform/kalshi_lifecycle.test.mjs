import test from 'node:test';
import assert from 'node:assert/strict';
import {makeKalshiLifecycle} from './kalshi_lifecycle.mjs';
const now=Date.parse('2026-10-24T20:00:00Z');
const ticker='KXNFLGAME-2026-TEST';
function fixture({balance=8,settlements=[],position='1.00',bid=.36,peak=.5,soloStatus='UNHEDGED',quoteAge=100,settlementError=false,submitResponse={fill_count:'1.00',order_id:'exit'}}={}){
 const seen=[];let watchStatus='WATCHING';const sql=async (q,p=[])=>{
  seen.push({q,p});
  if(q.includes('FROM kal_kings_solo_orders'))return [{ticker,status:soloStatus,yes_filled:'1.00',no_filled:'0.00',yes_price:'.45',no_price:'.50'}];
  if(q.includes('FROM kal_kings_position_watch'))return [{ticker,status:watchStatus,high_bid:String(peak)}];
  if(q.includes('INSERT INTO kal_kings_position_watch'))return [{ticker}];
  if(q.includes('UPDATE kal_kings_position_watch SET status=\'SUBMITTING\'')){if(watchStatus!=='WATCHING')return [];watchStatus='SUBMITTING';return [{ticker}];}
  if(q.includes('UPDATE kal_kings_position_watch')){watchStatus=p[1];return [{ticker}];}
  if(q.includes('INSERT INTO kal_kings_bot_settlements'))return [{ticker}];
  throw Error(q);
 };
 const submits=[];
 const deps={fetchAccount:async()=>({status:'VERIFIED',balance,positionsComplete:true,
   holdings:[{ticker,position:Number(position)}]}),fetchSettlements:async()=>{if(settlementError)throw Error('Provider HTTP 403');return settlements;},
  fetchMarket:async()=>({id:ticker,yesBid:bid,yesBidDepth:4,observedAt:new Date(now-quoteAge).toISOString()}),sql,
  submit:async order=>{submits.push(order);return submitResponse},createId:()=> '123e4567-e89b-42d3-a456-426614174000',now:()=>now};
 return {run:makeKalshiLifecycle(deps),seen,submits};
}
test('reinvesting balance is read from exchange and a settled cash credit is never fabricated',async()=>{
 const f=fixture({soloStatus:'HEDGED',balance:6,settlements:[{ticker,settled_time:new Date(now-100).toISOString(),market_result:'yes'}]});
 const out=await f.run();assert.equal(out.freeCash,6);assert.equal(out.confirmedSettlements,1);assert.equal(f.submits.length,0);
 assert.equal(f.seen.some(x=>/UPDATE kal_kings_bankroll|amount_cents\s*=/.test(x.q)),false);
});
test('watches underwater bot-owned position and submits reduce-only stop',async()=>{
 const f=fixture({bid:.35,peak:.48});const out=await f.run();
 assert.equal(out.exitsSubmitted,1);assert.equal(out.exitReceiptsConfirmed,1);
 assert.equal(f.submits.length,1);assert.equal(f.submits[0].side,'ask');assert.equal(f.submits[0].reduce_only,true);
});
test('if a stop is too stale, does not send any order',async()=>{
 const f=fixture({quoteAge:5000});const out=await f.run();assert.equal(out.exitsSubmitted,0);assert.equal(f.submits.length,0);
});
test('does not close personal or unconfirmed position not held on exchange',async()=>{
 const f=fixture({position:'0'});const out=await f.run();assert.equal(out.exitsSubmitted,0);assert.equal(f.submits.length,0);
});
test('partial fill is marked unresolved, without retrying order automatically',async()=>{
 const f=fixture({submitResponse:{fill_count:'0.25'}});const out=await f.run();assert.equal(out.exitsSubmitted,1);assert.equal(out.exitReceiptsConfirmed,0);
 assert.equal(f.seen.some(x=>x.q.includes('UPDATE kal_kings_position_watch')&&x.p[1]==='UNCERTAIN'),true);
});

test('failed settlement history feed does not block exchange-cash reuse and position checks',async()=>{
 const f=fixture({balance:5,soloStatus:'HEDGED',settlementError:true});
 const output=await f.run();
 assert.equal(output.freeCash,5);
 assert.equal(output.status,'MONITORED');
 assert.equal(output.settlementFeed,'UNAVAILABLE');
 assert.equal(output.pendingReview,0);
 assert.equal(f.submits.length,0);
});
