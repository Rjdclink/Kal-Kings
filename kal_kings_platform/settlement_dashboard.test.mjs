import test from 'node:test';
import assert from 'node:assert/strict';
import {settlementDashboardState} from './settlement_dashboard.mjs';
const account={status:'VERIFIED',positionsComplete:true,balance:4.5,holdings:[{ticker:'KXNFL-TEST',position:2,marketExposure:1.2}]};
test('filled Kalshi positions appear awaiting settlement',()=>{
 const out=settlementDashboardState({account,settlements:[]});
 assert.equal(out.pendingCount,1);assert.equal(out.pendingContracts,2);
 assert.equal(out.availableBalanceDollars,4.5);
});
test('a settled trade disappears and payout does not get credited twice',()=>{
 const out=settlementDashboardState({account,settlements:[{ticker:'KXNFL-TEST',market_result:'yes',revenue:200,settled_time:'2026-10-26T20:00:00Z'}]});
 assert.equal(out.pendingCount,0);assert.equal(out.latestSettlementPayoutDollars,2);
 assert.equal(out.availableBalanceDollars,4.5);
});
test('unavailable Kalshi positions never display a misleading zero and settlement failures do not erase open positions',()=>{
 assert.equal(settlementDashboardState({account:{status:'UNAVAILABLE'},settlements:[]}).pendingCount,null);
 assert.equal(settlementDashboardState({account,settlements:null}).pendingCount,1);
});