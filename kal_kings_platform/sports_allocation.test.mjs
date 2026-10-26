import test from 'node:test';
import assert from 'node:assert/strict';
import {sportsLeadTier,monteCarloLateGameAllocation,monteCarloOverAllocation} from './sports_allocation.mjs';

test('late-game allocation increases with lead and lower remaining time across NFL NBA NHL',()=>{
 for(const s of ['NFL','NBA','NHL']){
  const spec={NFL:{period:4,maxClock:600,minLead:14},NBA:{period:4,maxClock:360,minLead:12},NHL:{period:3,maxClock:480,minLead:2}}[s];
  const common={sport:s,period:spec.period,now:Date.parse('2026-10-26T16:10:00Z')};
  const early=sportsLeadTier({...common,lead:spec.minLead,clockSeconds:spec.maxClock});
  const bigger=sportsLeadTier({...common,lead:spec.minLead+10,clockSeconds:spec.maxClock});
  const later=sportsLeadTier({...common,lead:spec.minLead,clockSeconds:25});
  const peak=sportsLeadTier({...common,lead:spec.minLead+40,clockSeconds:5});
  assert.equal(early.eligible,true);assert.equal(early.maxAllocationFraction,.10);
  assert.ok(bigger.maxAllocationFraction>=early.maxAllocationFraction);
  assert.ok(later.maxAllocationFraction>=early.maxAllocationFraction);
  assert.equal(peak.maxAllocationFraction,.50);
  assert.equal(sportsLeadTier({...common,lead:spec.minLead-1,clockSeconds:25}).eligible,false);
  assert.equal(sportsLeadTier({...common,lead:spec.minLead+50,clockSeconds:spec.maxClock+1}).eligible,false);
 }
});

test('Monte Carlo sizes late-game trades but cannot approve score/time-ineligible game',()=>{
 const invalid={sport:'NBA',period:4,lead:9,clockSeconds:20};
 const denied=monteCarloLateGameAllocation({...invalid,bankroll:100});
 assert.equal(denied.eligible,false);assert.equal(denied.allocationFraction,0);
 const ok=monteCarloLateGameAllocation({sport:'NBA',period:4,lead:25,clockSeconds:45,bankroll:100,seed:73});
 assert.equal(ok.eligible,true);assert.ok(ok.trials>=2500);
 assert.ok(ok.allocationFraction>0&&ok.allocationFraction<=ok.maxAllocationFraction);
 assert.equal(ok.modeledProbabilityIsEntryGate,false);
});

test('verified already-crossed OVER bankroll allocation is between 75 and 80 percent',()=>{
 const a=monteCarloOverAllocation({bankroll:100,price:.8,depth:2000,seed:51});
 const b=monteCarloOverAllocation({bankroll:100,price:.8,depth:2000,seed:51});
 assert.equal(a.allocationFraction,b.allocationFraction);
 assert.ok(a.trials>=2500);
 assert.ok(a.allocationFraction>=.75&&a.allocationFraction<=.8);
 assert.equal(a.modeledProbabilityIsEntryGate,false);
});
import {planLateGameOrder} from './sports_allocation.mjs';
const now=Date.parse('2026-10-26T20:00:00Z');
const market={ticker:'KXNBAGAME-TEST',status:'active',observedAt:new Date(now-1000).toISOString(),yesAsk:.78,yesDepth:800};
const game={sport:'NBA',period:4,homeScore:122,awayScore:94,clockSeconds:35};
test('late game YES execution depends on lead and clock, not a 70 or 85 percent win forecast',()=>{
 const result=planLateGameOrder({game,market,bankroll:100,feePerContract:.01,holdings:[],now});
 assert.equal(result.allowed,true);assert.equal(result.side,'yes');
 assert.equal(result.modeledProbabilityIsEntryGate,false);
 assert.equal(result.modeledWinProbability,null);
 assert.ok(result.estimatedMaxDebitDollars<=50);
 assert.ok(result.netIfWinDollars>0);
});
test('score and time below policy threshold always reject; price/fee is never a guaranteed profit',()=>{
 const denied=planLateGameOrder({game:{...game,homeScore:105,awayScore:104},market,bankroll:100,feePerContract:.01,holdings:[],now});
 assert.equal(denied.allowed,false);
 assert.equal(planLateGameOrder({game,market:{...market,yesAsk:.995},bankroll:100,feePerContract:.01,holdings:[],now}).allowed,false);
 assert.equal(planLateGameOrder({game,market,bankroll:100,feePerContract:.01,holdings:[{ticker:market.ticker,position:1}],now}).allowed,false);
});
