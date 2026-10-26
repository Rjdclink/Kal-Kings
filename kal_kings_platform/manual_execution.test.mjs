import test from 'node:test';
import assert from 'node:assert/strict';
import {makeManualExecutor} from './manual_execution.mjs';
const time=Date.parse('2026-10-26T14:03:00Z');
const market={id:'KXBTC15M-26OCT261015-15',status:'active',
  closeTime:new Date(time+10*60000).toISOString(),
  observedAt:new Date(time).toISOString()};
const book={orderbook_fp:{yes_dollars:[['0.4500','30.00']],no_dollars:[['0.5300','30.00']]}};
const fee={feeType:'quadratic',feeMultiplier:1};
const account={status:'VERIFIED',balance:15,positionsComplete:true,holdings:[]};
function setup(extra={}){
 const intents=new Map(),orders=[];
 const sql=async(query,args=[])=>{
  if(query.includes('INSERT INTO kal_kings_manual_intents')){
   intents.set(args[0],{id:args[0],ticker:args[1],side:args[2],count:Number(args[3]),
     limit_price:Number(args[4]),max_debit:Number(args[5]),client_order_id:args[6],
     status:'PREVIEW',expires_at:new Date(time+30000).toISOString()});
   return [{id:args[0]}];
  }
  if(query.includes("status='SUBMITTING'")&&query.includes('RETURNING')){
   const value=intents.get(args[0]);
   if(!value||value.status!=='PREVIEW')return [];
   value.status='SUBMITTING';return [{...value}];
  }
  if(query.includes('FROM kal_kings_manual_intents')&&
     query.includes('status IN')){
    return [...intents.values()].filter(x=>['UNCERTAIN','SUBMITTING'].includes(x.status))
      .map(x=>({...x,contracts:String(x.count)}));
  }
  if(query.includes('UPDATE kal_kings_manual_intents')){
   const value=intents.get(args[0]);
   if(value)value.status=args[1];
   return [];
  }
  throw Error('Unexpected SQL');
 };
 let id=0;
 const deps={sql,fetchAccount:async()=>account,fetchMarket:async()=>market,
   fetchOrderbook:async()=>book,fetchFeeSchedule:async()=>fee,
   submit:async order=>{orders.push(order);return {order_id:'k123',fill_count:order.count}},
   createId:()=> '123e4567-e89b-42d3-a456-'+String(++id).padStart(12,'0'),
   now:()=>time,...extra};
 return{executor:makeManualExecutor(deps),orders,intents};
}
test('preview is not an order and states maximum real debit',async()=>{
 const f=setup();const p=await f.executor.preview({ticker:market.id,side:'no',count:1});
 assert.equal(p.allowed,true);assert.ok(p.maxDebitDollars>0);
 assert.equal(f.orders.length,0);assert.ok(p.intentId);
});
test('an explicitly selected manual NO purchase submits FOK once',async()=>{
 const f=setup();const p=await f.executor.preview({ticker:market.id,side:'no',count:1});
 const r=await f.executor.execute({intentId:p.intentId});
 assert.equal(r.status,'FILLED');assert.equal(f.orders.length,1);
 assert.equal(f.orders[0].side,'ask');assert.equal(f.orders[0].price,'0.4500');
 const repeat=await f.executor.execute({intentId:p.intentId});
 assert.equal(repeat.status,'ALREADY_ATTEMPTED');assert.equal(f.orders.length,1);
});
test('more expensive requote cannot silently increase the previewed debit',async()=>{
 let calls=0;
 const f=setup({fetchOrderbook:async()=>{calls++;return calls===1?book:{
   orderbook_fp:{yes_dollars:[['0.2500','30.00']],no_dollars:[['0.3000','30.00']]}}}});
 const p=await f.executor.preview({ticker:market.id,side:'yes',count:1});
 const result=await f.executor.execute({intentId:p.intentId});
 assert.equal(result.status,'NOT_ELIGIBLE');assert.equal(f.orders.length,0);
});
test('ambiguous Kalshi network errors remain uncertain, never auto-repeat',async()=>{
 let attempt=0;const f=setup({submit:async()=>{attempt++;throw Error('read timeout')}});
 const p=await f.executor.preview({ticker:market.id,side:'yes',count:1});
 const r=await f.executor.execute({intentId:p.intentId});
 assert.equal(r.status,'UNCERTAIN');
 assert.equal((await f.executor.execute({intentId:p.intentId})).status,'ALREADY_ATTEMPTED');
 assert.equal(attempt,1);
});
test('manual execution rechecks verified bankroll before submitting',async()=>{
 let calls=0;const f=setup({fetchAccount:async()=>{calls++;return calls===1?account:{...account,balance:0}}});
 const p=await f.executor.preview({ticker:market.id,side:'yes',count:1});
 const r=await f.executor.execute({intentId:p.intentId});
 assert.equal(r.status,'NOT_ELIGIBLE');assert.equal(f.orders.length,0);
});

test('explicit Kalshi HTTP 403 is a rejected order, not an uncertain fill',async()=>{
 const f=setup({submit:async()=>{const e=new Error('Kalshi refused this order');e.httpStatus=403;throw e}});
 const p=await f.executor.preview({ticker:market.id,side:'no',count:1});
 const receipt=await f.executor.execute({intentId:p.intentId});
 assert.equal(receipt.status,'REJECTED');
 assert.equal(receipt.reason,'KALSHI_ORDER_PERMISSION_DENIED');
 assert.equal(f.intents.get(p.intentId).status,'REJECTED');
});
test('confirmed 400 price validation error does not falsely report an ambiguous execution',async()=>{
 const f=setup({submit:async()=>{const e=new Error('Kalshi returned 400');e.httpStatus=400;throw e}});
 const p=await f.executor.preview({ticker:market.id,side:'yes',count:1});
 const receipt=await f.executor.execute({intentId:p.intentId});
 assert.equal(receipt.status,'REJECTED');
 assert.equal(receipt.reason,'KALSHI_ORDER_INVALID');
});
test('uncertain orders are reconciled from read-only exchange order history by client ID',async()=>{
 const f=setup();
 const p=await f.executor.preview({ticker:market.id,side:'no',count:1});
 const intent=f.intents.get(p.intentId);intent.status='UNCERTAIN';
 const seen=await f.executor.reconcilePending({
   readOrderHistory:async ticker=>[{ticker,client_order_id:intent.client_order_id,
     order_id:'safe-exchange-order',fill_count_fp:'1.00',status:'executed'}]
 });
 assert.equal(seen.confirmed,1);
 assert.equal(f.intents.get(p.intentId).status,'FILLED');
});

test('a disclosed one-cent limit cushion accommodates normal live quote movement without a second click',async()=>{
 let reads=0;
 const moving={orderbook_fp:{yes_dollars:[['0.4500','30.00']],no_dollars:[['0.5200','30.00']]}};
 const f=setup({fetchOrderbook:async()=>{reads++;return reads===1?book:moving}});
 const p=await f.executor.preview({ticker:market.id,side:'yes',count:1});
 assert.equal(p.currentBestAsk,.47);
 assert.equal(p.limitPrice,.48);
 const receipt=await f.executor.execute({intentId:p.intentId});
 assert.equal(receipt.status,'FILLED');
 assert.equal(f.orders[0].price,'0.4800');
});

test('resting unfilled manual order is canceled and recorded unfilled only after confirmed Kalshi cancellation',async()=>{
 const f=setup({fetchOrders:async ticker=>[]});
 const preview=await f.executor.preview({ticker:market.id,side:'no',count:1});
 const intent=f.intents.get(preview.intentId);intent.status='UNCERTAIN';
 let canceled=0;
 const report=await f.executor.reconcilePending({
   readOrderHistory:async ticker=>[{ticker,client_order_id:intent.client_order_id,order_id:'kal-order-1',
      fill_count_fp:'0.00',status:canceled?'canceled':'resting'}],
   cancelUnfilledOrder:async orderId=>{assert.equal(orderId,'kal-order-1');canceled++;return {order_id:orderId,reduced_by:'1.00'};}
 });
 assert.equal(canceled,1);
 assert.equal(report.confirmed,1);
 assert.equal(f.intents.get(preview.intentId).status,'NOT_FILLED');
});
test('uncertain order absent from incomplete history remains uncertain rather than falsely canceled',async()=>{
 const f=setup();
 const preview=await f.executor.preview({ticker:market.id,side:'yes',count:1});
 f.intents.get(preview.intentId).status='UNCERTAIN';
 const report=await f.executor.reconcilePending({readOrderHistory:async()=>[]});
 assert.equal(report.confirmed,0);
 assert.equal(f.intents.get(preview.intentId).status,'UNCERTAIN');
});
test('resting order with a confirmed partial fill cannot be marked NOT_FILLED after cancellation',async()=>{
 const f=setup();const preview=await f.executor.preview({ticker:market.id,side:'no',count:1});
 const intent=f.intents.get(preview.intentId);intent.status='UNCERTAIN';
 let canceled=false;
 const report=await f.executor.reconcilePending({
 readOrderHistory:async ticker=>[{ticker,client_order_id:intent.client_order_id,order_id:'kal-order-2',
 fill_count_fp:'0.50',status:canceled?'canceled':'resting'}],
 cancelUnfilledOrder:async()=>{canceled=true;return {order_id:'kal-order-2',reduced_by:'0.50'};}});
 assert.equal(report.confirmed,1);
 assert.equal(f.intents.get(preview.intentId).status,'PARTIALLY_FILLED');
});
