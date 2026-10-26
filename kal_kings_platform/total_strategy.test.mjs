import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAlreadyExceededTotal} from './total_strategy.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const game={id:'abc',sport:'NFL',state:'in',homeScore:30,awayScore:17,
  period:4,clockSeconds:300,updatedAt:new Date(now-1000).toISOString(),
  homeAbbreviation:'PHI',awayAbbreviation:'DAL',date:'2026-10-26'};
const market={ticker:'KXNFLTOTAL-26OCT26DALPHI-44',status:'active',
  floorStrike:44.5,rulesPrimary:'If Dallas and Philadelphia collectively score more than 44.5 points, then the market resolves to Yes.',
  closeTime:new Date(now+360000).toISOString(),observedAt:new Date(now-1000).toISOString(),
  yesAsk:.87,yesDepth:20};
test('verified score past official total allows a positive one-sided market opportunity',()=>{
 const v=assessAlreadyExceededTotal({game,market,bankroll:15,feePerContract:.02,now});
 assert.equal(v.allowed,true);assert.equal(v.strategy,'TOTAL_ALREADY_OVER');
 assert.equal(v.side,'yes');assert.equal(v.contracts,1);
 assert.ok(v.netIfNormallySettledDollars>0);
});
test('a high displayed probability alone is not a clinched total',()=>{
 for(const changed of [{...game,homeScore:20,awayScore:16},{...game,state:'pre'},
   {...game,updatedAt:new Date(now-90000).toISOString()}]){
  const v=assessAlreadyExceededTotal({game:changed,market,bankroll:15,feePerContract:.02,now});
  assert.equal(v.allowed,false);
 }
});
test('rules mismatches, stale quotes and expensive contracts cannot trade',()=>{
 const changes=[{...market,floorStrike:50.5},{...market,rulesPrimary:'One team scores at least 44.5 points'},
  {...market,status:'closed'},{...market,observedAt:new Date(now-60000).toISOString()},
  {...market,yesAsk:.99},{...market,yesDepth:0}];
 for(const m of changes)assert.equal(assessAlreadyExceededTotal({game,market:m,bankroll:15,feePerContract:.02,now}).allowed,false);
});
test('cannot auto-order unverified or already-held event contracts',()=>{
 assert.equal(assessAlreadyExceededTotal({game,market,bankroll:15,feePerContract:.02,now,
   holdingsComplete:false}).allowed,false);
 assert.equal(assessAlreadyExceededTotal({game,market,bankroll:15,feePerContract:.02,now,
   holdings:[{ticker:market.ticker,position:1}]}).allowed,false);
});
