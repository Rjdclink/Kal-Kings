import test from 'node:test';
import assert from 'node:assert/strict';
import {findKalshiSoloCandidates, kalshiSoloLegs, summarizeSoloOrders} from './kalshi_solo.mjs';
const now=Date.parse('2026-10-24T20:00:00Z');
const quote=(changes={})=>({id:'KXNFLGAME-26TEST-YES',event:'Sports test',yesAsk:.43,noAsk:.51,yesDepth:20,noDepth:20,observedAt:new Date(now-500).toISOString(),updatedAt:new Date(now-500).toISOString(),...changes});
test('solo strategy uses only Kalshi quotes and does not accept a DraftKings dependency',()=>{
 const results=findKalshiSoloCandidates([quote()],{balance:100,now});
 assert.equal(results.length,1);assert.equal(results[0].source,'KALSHI_ONLY');
 assert.equal(results[0].marketTicker,'KXNFLGAME-26TEST-YES');
 assert.ok(results[0].netProfitDollars>0);
 assert.ok(results[0].requiredDollars<=100);
});
test('absence of qualified Kalshi prices never manufactures a trade',()=>{
 assert.deepEqual(findKalshiSoloCandidates([quote({noAsk:.6})],{balance:100,now}),[]);
 assert.deepEqual(findKalshiSoloCandidates([quote({noDepth:0})],{balance:100,now}),[]);
 assert.deepEqual(findKalshiSoloCandidates([quote({observedAt:new Date(now-15000).toISOString()})],{balance:100,now}),[]);
 assert.deepEqual(findKalshiSoloCandidates([quote()],{balance:.05,now}),[]);
});
test('two Kalshi legs have complementary book sides, exact prices and separate client IDs',()=>{
 const candidate=findKalshiSoloCandidates([quote()],{balance:100,now})[0];
 const [yes,no]=kalshiSoloLegs(candidate,['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']);
 assert.equal(yes.side,'bid');assert.equal(no.side,'ask');
 assert.equal(yes.ticker,no.ticker);assert.equal(yes.time_in_force,'fill_or_kill');
 assert.equal(yes.price,'0.4300');assert.equal(no.price,'0.4900');
 assert.equal(yes.count,no.count);
});
test('trade reporting counts only confirmed fills and flags unhedged legs',()=>{
 const list=[{ticker:'A',yes_filled:'1',no_filled:'1',status:'HEDGED',net_profit_dollars:'0.03'},
  {ticker:'B',yes_filled:'1',no_filled:'0',status:'UNHEDGED',net_profit_dollars:null},
  {ticker:'C',yes_filled:'0',no_filled:'0',status:'NOT_FILLED',net_profit_dollars:null}];
 const s=summarizeSoloOrders(list);
 assert.equal(s.fullyHedgedTrades,1);assert.equal(s.unhedgedPositions,1);assert.equal(s.notFilled,1);
 assert.equal(s.realizedProfitDollars,null);
});

test('a one-cent positive two-sided paired spread is eligible without arbitrary extra cent',()=>{
 const q={id:'KXNFLGAME-26OCT26DALPHI-PHI',yesAsk:.42,noAsk:.53,yesDepth:2,noDepth:2,observedAt:new Date(1793016000000).toISOString()};
 const results=findKalshiSoloCandidates([q],{balance:15,now:1793016000000});
 assert.ok(results.length>0);
 assert.ok(results[0].netProfitDollars>0);
});
