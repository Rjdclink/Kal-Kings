import test from 'node:test';
import assert from 'node:assert/strict';
import {riskPolicy, recommendedDirectional, simulateDirectional, impliedTwoWay, chooseHedge} from './strategy.mjs';

test('bankroll adaptive percentage rises with account size without a fixed dollar ceiling',()=>{
  const tiny=riskPolicy(25),large=riskPolicy(2500),big=riskPolicy(100000);
  assert.ok(tiny.riskPercent<large.riskPercent);
  assert.ok(large.riskPercent<=big.riskPercent);
  assert.ok(tiny.tailLimitDollars<1);
  assert.ok(big.tailLimitDollars>25);
  assert.ok(big.riskPercent<=3);
  assert.throws(()=>riskPolicy(-1));
});
test('nearly certain favorite with overpriced contract is a rejected opportunity',()=>{
  const p=recommendedDirectional({bankroll:1000,price:0.995,probability:0.99,depth:1000,sourceAgeMs:1000});
  assert.equal(p.accepted,false);
  assert.equal(p.reason,'NO_POSITIVE_EDGE');
});
test('profitable 98% favorite receives more stake than a less confident alternative with same edge',()=>{
  const a=recommendedDirectional({bankroll:5000,price:0.90,probability:0.98,depth:1000,sourceAgeMs:500});
  const b=recommendedDirectional({bankroll:5000,price:0.52,probability:0.60,depth:1000,sourceAgeMs:500});
  assert.equal(a.accepted,true);assert.equal(b.accepted,true);
  assert.ok(a.stakeDollars>b.stakeDollars);
  assert.ok(a.maximumLossDollars<=a.policy.hardLossLimitDollars+0.001);
});
test('minimum-lot exception may exceed tiny percentage but never spends beyond available bankroll',()=>{
  const a=recommendedDirectional({bankroll:25,price:.9,probability:.99,depth:1000,sourceAgeMs:1000});
  assert.equal(a.accepted,true);
  assert.equal(a.contracts,1);
  assert.equal(a.minimumTradeExceptionApplied,true);
  assert.ok(a.stakeDollars<=25);
});
test('stale or unavailable depth prevents an actionable recommendation',()=>{
  assert.equal(recommendedDirectional({bankroll:1000,price:.8,probability:.97,depth:100,sourceAgeMs:121000}).reason,'STALE_QUOTE');
  assert.equal(recommendedDirectional({bankroll:1000,price:.8,probability:.97,depth:0,sourceAgeMs:1000}).reason,'INSUFFICIENT_LIQUIDITY');
});
test('Monte Carlo excludes nonexecutions from loss rate and expected P/L',()=>{
  const s=simulateDirectional({contracts:10,price:.9,probability:.99,fillProbability:0,trials:1000,seed:22});
  assert.equal(s.executedTrials,0);
  assert.equal(s.lossFrequency,null);
  assert.equal(s.expectedProfit,null);
  assert.equal(s.noFillTrials,1000);
});
test('Monte Carlo executed losses do not get diluted by rejected/no-fill trials',()=>{
  const s=simulateDirectional({contracts:10,price:.90,probability:0,fillProbability:.15,trials:2000,seed:3});
  assert.ok(s.executedTrials>0 && s.executedTrials<2000);
  assert.equal(s.lossFrequency,100);
  assert.equal(s.expectedProfit,-9);
});
test('de-vig probability only uses two distinct, valid opposing prices',()=>{
  const p=impliedTwoWay([{selection:'Steelers',american:-900},{selection:'Colts',american:600}],'Steelers');
  assert.ok(p>0.8&&p<1);
  assert.equal(impliedTwoWay([{selection:'Steelers',american:-100}],'Steelers'),null);
  assert.equal(impliedTwoWay([{selection:'Steelers',american:-900},{selection:'Steelers',american:600}],'Steelers'),null);
});
test('DraftKings hedge recommends actual two-way payout-equalized stake within separate balances',()=>{
  const h=chooseHedge({kalshiAsk:.45,dkOdds:110,kalshiBalance:1000,dkBalance:1000,availableDepth:1000,bankroll:2000});
  assert.ok(h && h.kalshiContracts>=1);
  assert.ok(Math.abs(h.dkStakeDollars*2.1-h.kalshiContracts)<=0.02);
  assert.ok(h.dkStakeDollars<=1000);
  assert.ok(h.minimumNetProfit>0);
  assert.ok(h.kalshiCostDollars<=1000);
});

test('variable risk rate scales with bankroll without a fixed $25 dollar ceiling',()=>{
 const tiny=riskPolicy(.05),large=riskPolicy(2500),huge=riskPolicy(100000);
 assert.equal(tiny.riskPercent,.75);
 assert.ok(tiny.hardLossLimitDollars>0);
 assert.ok(large.hardLossLimitDollars>25);
 assert.ok(huge.hardLossLimitDollars>large.hardLossLimitDollars);
 assert.ok(huge.hardLossLimitDollars<=100000);
});

test('a verified positive-edge trade can use a single affordable contract despite subcent percent budget',()=>{
 const r=recommendedDirectional({bankroll:.05,price:.02,probability:.75,depth:50,sourceAgeMs:200,feePerContract:.01});
 assert.equal(r.accepted,true);
 assert.equal(r.contracts,1);
 assert.ok(r.maximumLossDollars<=.05);
 assert.equal(r.minimumTradeExceptionApplied,true);
});

test('minimum trade allowance never borrows funds or pays for a poor or stale trade',()=>{
 assert.equal(recommendedDirectional({bankroll:.02,price:.03,probability:.95,depth:30,sourceAgeMs:200,feePerContract:.01}).accepted,false);
 assert.equal(recommendedDirectional({bankroll:.05,price:.04,probability:.045,depth:30,sourceAgeMs:200,feePerContract:.01}).accepted,false);
 assert.equal(recommendedDirectional({bankroll:.05,price:.02,probability:.75,depth:30,sourceAgeMs:95000,feePerContract:.01}).accepted,false);
});
