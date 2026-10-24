import test from 'node:test';
import assert from 'node:assert/strict';
import {makeKalshiLifecycle} from './kalshi_lifecycle.mjs';
const now=Date.parse('2026-10-24T20:00:00Z');
const ticker='KXNFLGAME-2026-CHI';
function scenario(quantSignal){let sent=[],recorded=[];
 const sql=async(q,args=[])=>{
   if(q.includes('FROM kal_kings_solo_orders'))return [{ticker,status:'UNHEDGED',yes_filled:'1.00',no_filled:'0.00',yes_price:'.45',no_price:'.50'}];
   if(q.includes('FROM kal_kings_position_watch'))return [{ticker,status:'WATCHING',high_bid:'.48'}];
   if(q.includes('INSERT INTO kal_kings_position_watch'))return [];
   if(q.includes("SET status='SUBMITTING'"))return [{ticker}];
   if(q.includes('UPDATE kal_kings_position_watch'))return [];
   throw Error('unexpected sql '+q);
 };
 const m=makeKalshiLifecycle({fetchAccount:async()=>({balance:5,holdings:[{ticker,position:1}],positionsComplete:true}),
   fetchSettlements:async()=>[],fetchMarket:async()=>({id:ticker,yesBid:.52,yesBidDepth:10,observedAt:new Date(now).toISOString()}),sql,
   recordQuantQuote:async v=>recorded.push(v),
   getQuantHistory:async()=>Array.from({length:20},(_,i)=>({observedAt:new Date(now-(20-i)*60000).toISOString(),bid:.4+i*.001,ask:.42+i*.001})),
   quantExit:()=>quantSignal,submit:async req=>{sent.push(req);return {order_id:'test',fill_count:'1.00'};},
   createId:()=> '123e4567-e89b-42d3-a456-426614174000',now:()=>now});
 return {m,sent,recorded};
}
test('Monte Carlo evidence may close a bot-owned trade independently of static stop thresholds',async()=>{
 const f=scenario({status:'MODELED',action:'SELL',exitAdvantageDollars:.03});
 const out=await f.m();assert.equal(out.exitsSubmitted,1);assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].reduce_only,true);assert.equal(f.sent[0].time_in_force,'immediate_or_cancel');
 assert.equal(f.recorded.length,1);
});
test('missing or weak Monte Carlo signal does not force sale when price has not crossed stops',async()=>{
 const f=scenario({status:'INSUFFICIENT_HISTORY',action:'UNKNOWN'});
 const out=await f.m();assert.equal(out.exitsSubmitted,0);assert.equal(f.sent.length,0);
});
test('incomplete authenticated positions prevent managing potentially personal trades',async()=>{
 const f=scenario({status:'MODELED',action:'SELL',exitAdvantageDollars:3});
 const m=makeKalshiLifecycle({fetchAccount:async()=>({balance:5,holdings:[],positionsComplete:false}),fetchSettlements:async()=>[],
   fetchMarket:async()=>{throw Error('must not trade');},sql:async()=>{throw Error('must not query');},submit:async()=>{throw Error('must not send');}});
 const o=await m();assert.equal(o.status,'ACCOUNT_UNAVAILABLE');
});
