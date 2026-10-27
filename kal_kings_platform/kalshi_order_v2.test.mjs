import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKalshiOrderV2} from './kalshi_order_v2.mjs';

test('converts a legacy YES buy into the V2 single-book bid shape',()=>{
  assert.deepEqual(normalizeKalshiOrderV2({
    ticker:'KXTEST-26OCT26-YES',client_order_id:'00000000-0000-4000-8000-000000000001',
    action:'buy',side:'yes',count:2,yes_price_dollars:'0.4300',type:'limit',
    time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true
  }),{
    ticker:'KXTEST-26OCT26-YES',client_order_id:'00000000-0000-4000-8000-000000000001',
    side:'bid',count:'2.00',price:'0.4300',time_in_force:'fill_or_kill',
    self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true
  });
});

test('converts a legacy NO buy into the complementary V2 YES-book ask price',()=>{
  const result=normalizeKalshiOrderV2({
    ticker:'KXTEST-26OCT26-YES',client_order_id:'00000000-0000-4000-8000-000000000002',
    action:'buy',side:'no',count:1,no_price_dollars:'0.5100',type:'limit',
    time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross'
  });
  assert.equal(result.side,'ask');
  assert.equal(result.price,'0.4900');
  assert.equal(result.count,'1.00');
  assert.equal('action' in result,false);
  assert.equal('no_price_dollars' in result,false);
});

test('preserves an already-V2 reduce-only exit order without changing its YES-scale price',()=>{
  const order={ticker:'KXTEST-26OCT26-YES',client_order_id:'00000000-0000-4000-8000-000000000003',
    side:'ask',count:'1.00',price:'0.3700',reduce_only:true,time_in_force:'immediate_or_cancel',
    self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true};
  assert.deepEqual(normalizeKalshiOrderV2(order),order);
});

test('rejects malformed order shapes instead of sending them to Kalshi',()=>{
  assert.throws(()=>normalizeKalshiOrderV2({ticker:'bad',side:'yes',action:'buy',count:1,yes_price_dollars:'0.5'}));
  assert.throws(()=>normalizeKalshiOrderV2({ticker:'KXTEST-26OCT26-YES',side:'yes',action:'buy',count:1,yes_price_dollars:'1.0000'}));
});
