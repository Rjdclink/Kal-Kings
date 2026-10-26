import test from 'node:test';
import assert from 'node:assert/strict';
import {planManualKalshiBuy,buildManualBuyOrder} from './manual_trading.mjs';
const now=Date.parse('2026-10-26T14:03:00Z');
const book={orderbook_fp:{
 yes_dollars:[['0.4500','30.00'],['0.4600','40.00']],
 no_dollars:[['0.5300','40.00'],['0.5200','20.00']]}};
const market={id:'KXBTC15M-26OCT261015-15',ticker:'KXBTC15M-26OCT261015-15',
 status:'active',closeTime:new Date(now+600000).toISOString(),
 observedAt:new Date(now-400).toISOString()};
const feeSchedule={feeType:'quadratic',feeMultiplier:1};
test('a fresh YES manual ticket uses actual book depth and capped cash',()=>{
 const r=planManualKalshiBuy({market,bookResponse:book,feeSchedule,side:'yes',count:1,bankroll:15,now});
 assert.equal(r.allowed,true);assert.equal(r.side,'yes');assert.equal(r.limitPrice,.47);
 assert.ok(r.maxDebitDollars>0&&r.maxDebitDollars<3.75);
});
test('NO manual ticket correctly reverses the exchange YES price scale',()=>{
 const r=planManualKalshiBuy({market,bookResponse:book,feeSchedule,side:'no',count:1,bankroll:15,now});
 assert.equal(r.allowed,true);assert.equal(r.limitPrice,.55);
 const order=buildManualBuyOrder(r,'123e4567-e89b-42d3-a456-426614174000');
 assert.equal(order.side,'ask');assert.equal(order.price,'0.4500');
 assert.equal(order.time_in_force,'fill_or_kill');
});
test('manual ticket cannot exceed 25 percent of free cash or available depth',()=>{
 assert.equal(planManualKalshiBuy({market,bookResponse:book,feeSchedule,side:'yes',count:20,bankroll:15,now}).allowed,false);
 assert.equal(planManualKalshiBuy({market,bookResponse:book,feeSchedule,side:'no',count:1,bankroll:0,now}).allowed,false);
});
test('missing official fee schedule, stale book, and closed market never generate a buy order',()=>{
 assert.equal(planManualKalshiBuy({market,bookResponse:book,side:'yes',count:1,bankroll:15,now}).allowed,false);
 assert.equal(planManualKalshiBuy({market:{...market,observedAt:new Date(now-9000).toISOString()},bookResponse:book,feeSchedule,side:'yes',count:1,bankroll:15,now}).allowed,false);
 assert.equal(planManualKalshiBuy({market:{...market,status:'closed'},bookResponse:book,feeSchedule,side:'yes',count:1,bankroll:15,now}).allowed,false);
});
test('executed FOK limit cannot exceed the previewed debit',()=>{
 const p=planManualKalshiBuy({market,bookResponse:book,feeSchedule,side:'no',count:2,bankroll:15,now});
 const order=buildManualBuyOrder(p,'123e4567-e89b-42d3-a456-426614174000');
 assert.ok(p.maxDebitDollars<=15*.25);
 assert.equal(order.count,'2.00');
});
