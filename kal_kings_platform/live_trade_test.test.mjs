import test from 'node:test';
import assert from 'node:assert/strict';
import {planOneTimeMicroOrder,interpretMicroReceipt} from './live_trade_test.mjs';
const ticker='KXMLSGAME-26OCT24CLBTOR-TIE';
const book={orderbook_fp:{yes_dollars:[],no_dollars:[['0.9900','5.00']]}};
const data={ticker,marketStatus:'active',yesAsk:0.01,book,balance:0.0543,positionsComplete:true};
test('one-time micro integration trade fits real available cash, fees and hard micro budget',()=>{
 const a=planOneTimeMicroOrder(data);
 assert.equal(a.allowed,true);assert.equal(a.totalMaxDollars,0.02);
 assert.equal(a.contracts,1);assert.equal(a.price,0.01);
 assert.equal(a.side,'bid');assert.equal(a.marketTicker,ticker);
 assert.ok(a.totalMaxDollars<=0.03);
});
test('does not buy without account holdings completeness or enough available cash',()=>{
 assert.equal(planOneTimeMicroOrder({...data,positionsComplete:false}).allowed,false);
 assert.equal(planOneTimeMicroOrder({...data,balance:0.019}).allowed,false);
});
test('rejects invalid, unaffordable, or stale quote and empty order books',()=>{
 assert.equal(planOneTimeMicroOrder({...data,yesAsk:0.05}).allowed,false);
 assert.equal(planOneTimeMicroOrder({...data,marketStatus:'closed'}).allowed,false);
 assert.equal(planOneTimeMicroOrder({...data,book:{orderbook_fp:{yes_dollars:[],no_dollars:[]}}}).allowed,false);
 assert.equal(planOneTimeMicroOrder({...data,book:{orderbook_fp:{yes_dollars:[],no_dollars:[['0.7000','5']]}}}).allowed,false);
});
test('only confirmed fetched order fill is counted as an executed test trade',()=>{
 assert.equal(interpretMicroReceipt({post:{order_id:'x',fill_count:'1.00'},confirmed:{order:{order_id:'x',fill_count_fp:'1.00'}}}), 'FILLED');
 assert.equal(interpretMicroReceipt({post:{order_id:'x',fill_count:'1.00'},confirmed:null}),'UNCERTAIN');
 assert.equal(interpretMicroReceipt({post:{order_id:'x',fill_count:'0.00'},confirmed:null}),'NOT_FILLED');
 assert.equal(interpretMicroReceipt({post:{order_id:'x',fill_count:'1.00'},confirmed:{order:{order_id:'different',fill_count_fp:'1.00'}}}),'UNCERTAIN');
});
