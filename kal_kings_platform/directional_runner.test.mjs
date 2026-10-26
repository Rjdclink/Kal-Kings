import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDirectionalRunner} from './directional_runner.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const ticker='KXNFLGAME-26OCT26DALPHI-PHI';
const idea={id:'1',eventKey:'NFL:2026-10-26:DAL:PHI',strategy:'LATE_GAME_LEAD',
 market:{ticker,status:'active',yesAsk:.7,yesDepth:12,observedAt:new Date(now).toISOString(),closeTime:new Date(now+180000).toISOString()},
 probability:.91,sourceVerified:true,marketMatchVerified:true,modelPlayId:'p56',updatedAt:new Date(now).toISOString()};
const book={orderbook_fp:{yes_dollars:[['0.6900','12.00']],no_dollars:[['0.3000','12.00']]}};
function fixture(override={}){
 let orders=[],rows=new Map(),requests=0;
 const sql=async(q,args=[])=>{
  if(q.includes('COUNT(*)')&&q.includes('kal_kings_directional_orders'))return [{n:'0'}];
  if(q.includes('INSERT INTO kal_kings_directional_orders')){if(rows.has(args[0]))return [];rows.set(args[0],{status:'SUBMITTING'});return [{ticker:args[0]}];}
  if(q.includes('UPDATE kal_kings_directional_orders'))return [];
  return [];
 };
 const deps={sql,fetchMarket:async()=>({id:ticker,...idea.market,yesAsk:.7,yesDepth:12}),
  fetchOrderbook:async()=>book,submit:async o=>{orders.push(o);return {order_id:'abc',fill_count:'1.00'};},
  now:()=>now,createId:()=> '123e4567-e89b-42d3-a456-426614174000',
  ...override};
 return {runner:makeDirectionalRunner(deps),orders,rows};
}
test('independently verified positive-value live leader may submit one bounded order',async()=>{
 const f=fixture();
 const r=await f.runner({ideas:[idea],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(r.status,'FILLED');assert.equal(f.orders.length,1);
 assert.equal(f.orders[0].ticker,ticker);assert.equal(f.orders[0].side,'bid');
});
test('unverified, stale, expensive, and unfunded plans never send orders',async()=>{
 const cases=[{...idea,sourceVerified:false},{...idea,updatedAt:new Date(now-30000).toISOString()},
 {...idea,probability:.80}];
 for(const x of cases){const f=fixture();const r=await f.runner({ideas:[x],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});assert.equal(f.orders.length,0);}
 const f=fixture();await f.runner({ideas:[idea],account:{balance:0,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(f.orders.length,0);
});
test('uncertain receipt never results in duplicate autonomous submission',async()=>{
 const f=fixture({submit:async()=>{throw Error('ambiguous network timeout')}});
 const account={balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'};
 const first=await f.runner({ideas:[idea],account});
 const second=await f.runner({ideas:[idea],account});
 assert.equal(first.status,'UNCERTAIN');assert.equal(second.status,'ALREADY_ATTEMPTED');
});
