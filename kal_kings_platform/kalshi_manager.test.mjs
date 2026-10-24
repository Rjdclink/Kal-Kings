import test from 'node:test';
import assert from 'node:assert/strict';
import {assessManagedExit, buildReductionOrder, cashAvailableForReinvestment, settlementEvidence, evaluateEntryTiming} from './kalshi_manager.mjs';

test('settled funds are eligible only after exchange reports available free cash',()=>{
 assert.deepEqual(cashAvailableForReinvestment({balance:0.05,positions:[{market_exposure_dollars:'0.50'}]}, {reserved:0}),{available:0.05,status:'AVAILABLE'});
 assert.equal(cashAvailableForReinvestment({balance:0}, {reserved:0}).available,0);
 assert.equal(cashAvailableForReinvestment({balance:100}, {reserved:100}).available,0);
 assert.equal(cashAvailableForReinvestment({balance:10}, {reserved:12}).status,'UNAVAILABLE');
});
test('never double credits settlement payouts or assumes pending settlement is cash',()=>{
 const s=settlementEvidence([{ticker:'KXTEST-1',settled_time:'2026-10-24T16:00:00Z',market_result:'yes'}],'KXTEST-1');
 assert.equal(s.status,'SETTLED');
 assert.equal(s.credited, false);
 assert.equal(settlementEvidence([],'KXTEST-1').status,'NOT_CONFIRMED');
});
test('take profit does not cause a premature sale before trailing reversal',()=>{
 const decision=assessManagedExit({entryPrice:.4,bidPrice:.55,highestBid:.55,availableDepth:2,quantity:1,quoteAgeMs:100,estimatedExitFee:.01,takeProfitPercent:20,trailingPercent:10,stopLossPercent:12});
 assert.equal(decision.action,'HOLD');
 assert.equal(decision.netProfitDollars,.14);
});
test('trailing reversal sells to lock in a positive net return',()=>{
 const decision=assessManagedExit({entryPrice:.4,bidPrice:.49,highestBid:.57,availableDepth:2,quantity:1,quoteAgeMs:100,estimatedExitFee:.01,takeProfitPercent:20,trailingPercent:10,stopLossPercent:12});
 assert.equal(decision.action,'SELL');assert.equal(decision.reason,'TRAILING_PROFIT_EXIT');
});
test('stop loss assesses net proceeds and does not promise price',()=>{
 const decision=assessManagedExit({entryPrice:.4,bidPrice:.3,highestBid:.4,availableDepth:1,quantity:1,quoteAgeMs:100,estimatedExitFee:.01,stopLossPercent:12});
 assert.equal(decision.action,'SELL');assert.equal(decision.reason,'STOP_LOSS');
});
test('no exits against stale or illiquid bids',()=>{
 const p={entryPrice:.4,bidPrice:.3,highestBid:.4,quantity:1,estimatedExitFee:0,stopLossPercent:12};
 assert.equal(assessManagedExit({...p,availableDepth:1,quoteAgeMs:4001}).action,'UNAVAILABLE');
 assert.equal(assessManagedExit({...p,availableDepth:0,quoteAgeMs:100}).action,'UNAVAILABLE');
});
test('sell YES uses opposite book side with reduce only and no reversal',()=>{
 const order=buildReductionOrder({ticker:'KXTEST-ONE',direction:'yes',quantity:1,bidPrice:.5,clientOrderId:'123e4567-e89b-42d3-a456-426614174000'});
 assert.equal(order.side,'ask');assert.equal(order.price,'0.5000');assert.equal(order.reduce_only,true);
 assert.equal(order.time_in_force,'fill_or_kill');
});
test('sell NO uses opposite book side with correctly inverted yes-scale price',()=>{
 const order=buildReductionOrder({ticker:'KXTEST-ONE',direction:'no',quantity:1,bidPrice:.35,clientOrderId:'123e4567-e89b-42d3-a456-426614174000'});
 assert.equal(order.side,'bid');assert.equal(order.price,'0.6500');assert.equal(order.reduce_only,true);
});
test('entry timing cannot be inferred without sufficient fresh independent evidence',()=>{
 assert.equal(evaluateEntryTiming({candidate:{netProfitDollars:.5,requiredDollars:1},sourceAgeMs:0,verifiedSettlement:false}).action,'WAIT');
 assert.equal(evaluateEntryTiming({candidate:{netProfitDollars:.5,requiredDollars:1},sourceAgeMs:5000,verifiedSettlement:true}).action,'WAIT');
 assert.equal(evaluateEntryTiming({candidate:{netProfitDollars:.5,requiredDollars:1},sourceAgeMs:100,verifiedSettlement:true}).action,'QUALIFIED_NOW');
});
