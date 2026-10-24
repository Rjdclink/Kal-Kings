import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKalshiHedgePlan,kalshiV2Order} from './orders.mjs';
const now=Date.parse('2026-10-24T19:00:00Z');
const ticket={id:'w-1',pair_id:'pair-1',event:'Steelers @ Colts',selection:'Colts',odds:150,stake:10,status:'open',userConfirmed:true};
const mapping={id:'pair-1',kalshi_ticker:'KXNFLGAME-TEST',dk_selection:'Colts',kalshi_side:'yes',reviewed_at:new Date(now-1000).toISOString(),reviewed_rule_digest:'sha256:'+'a'.repeat(64)};
const market={id:'KXNFLGAME-TEST',yesAsk:.48,yesDepth:100,observedAt:new Date(now-1000).toISOString()};
test('no execution on unmatched or unconfirmed sportsbook wagers',()=>{
 assert.equal(buildKalshiHedgePlan({ticket:{...ticket,userConfirmed:false},mapping,market,balance:100,now}).accepted,false);
 assert.equal(buildKalshiHedgePlan({ticket,mapping:{...mapping,id:'other'},market,balance:100,now}).accepted,false);
});
test('no execution from a zero or insufficient Kalshi balance',()=>{
 assert.equal(buildKalshiHedgePlan({ticket,mapping,market,balance:0,now}).accepted,false);
 assert.equal(buildKalshiHedgePlan({ticket,mapping,market,balance:.05,now}).accepted,false);
});
test('stale quote, NO-side and unreviewed contract prevent real orders',()=>{
 assert.equal(buildKalshiHedgePlan({ticket,mapping,market:{...market,observedAt:new Date(now-20000).toISOString()},balance:100,now}).accepted,false);
 assert.equal(buildKalshiHedgePlan({ticket,mapping:{...mapping,kalshi_side:'no'},market,balance:100,now}).accepted,false);
 assert.equal(buildKalshiHedgePlan({ticket,mapping:{...mapping,reviewed_rule_digest:'bad'},market,balance:100,now}).accepted,false);
});
test('funded, reviewed, user-confirmed opposite wager can be planned only for positive outcomes',()=>{
 const plan=buildKalshiHedgePlan({ticket,mapping,market,balance:5000,now});
 assert.equal(plan.accepted,true);
 assert.ok(plan.count>0&&plan.capitalRequired<=5000);
 assert.ok(plan.kalshiWinProfit>0 && plan.dkWinProfit>0);
});
test('Kalshi V2 orders use fill-or-kill limits and unique IDs',()=>{
 const b=kalshiV2Order({ticker:'KXNFLGAME-TEST',count:12,yesPrice:.48,clientOrderId:'824e73a0-43cf-4a31-8722-06c343497c3a'});
 assert.deepEqual(b,{ticker:'KXNFLGAME-TEST',client_order_id:'824e73a0-43cf-4a31-8722-06c343497c3a',side:'bid',count:'12.00',price:'0.4800',time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true});
});
