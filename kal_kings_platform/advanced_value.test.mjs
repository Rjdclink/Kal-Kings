import test from 'node:test';
import assert from 'node:assert/strict';
import {matchSportsOutcome,assessKalshiValue,rankStrategies,assessTotalsProjection,adaptiveExitThresholds} from './strategy_optimizer.mjs';
const NOW=Date.parse('2026-10-26T12:00:00Z');
const market={ticker:'KXNFLGAME-26OCT26DALPHI-PHI',status:'active',yesAsk:.75,noAsk:.26,yesDepth:10,noDepth:10,observedAt:new Date(NOW-500).toISOString()};
test('exact game outcome requires both teams and date',()=>{
 const game={sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',selectedAbbreviation:'PHI'};
 assert.equal(matchSportsOutcome(game,market).matched,true);
 assert.equal(matchSportsOutcome({...game,awayAbbreviation:'NYG'},market).matched,false);
});
test('positive value requires independent verified probability and affordable executable quote',()=>{
 const data={market,side:'yes',probability:.90,probabilitySource:'ESPN_LIVE_MODEL',
 sourceVerified:true,marketMatchVerified:true,bankroll:15,holdings:[],feePerContract:.02,now:NOW};
 assert.equal(assessKalshiValue(data).allowed,true);
 assert.equal(assessKalshiValue({...data,probability:.84}).allowed,false);
 assert.equal(assessKalshiValue({...data,market:{...market,yesAsk:.95}}).allowed,false);
 assert.equal(assessKalshiValue({...data,marketMatchVerified:false}).allowed,false);
});
test('ranking removes correlated events and orders by risk-adjusted return',()=>{
 const rows=[{id:'A',eventKey:'one',allowed:true,expectedNetDollars:.08,estimatedMaxDebitDollars:.25,modeledLossFrequency:.1},
 {id:'B',eventKey:'one',allowed:true,expectedNetDollars:.1,estimatedMaxDebitDollars:.8,modeledLossFrequency:.1},
 {id:'C',eventKey:'two',allowed:true,expectedNetDollars:.07,estimatedMaxDebitDollars:.25,modeledLossFrequency:.12}];
 assert.deepEqual(rankStrategies(rows).map(x=>x.id),['A','C']);
});
test('rain wind and offensive absences influence a totals projection without enabling execution',()=>{
 const input={sport:'NFL',totalLine:44.5,homeScore:10,awayScore:7,period:3,clockSeconds:700,state:'in',
 updatedAt:new Date(NOW-1000).toISOString(),now:NOW};
 const calm=assessTotalsProjection({...input,weather:{windMph:4}});
 const windy=assessTotalsProjection({...input,weather:{windMph:28,indoor:false},injuries:[{role:'QB',status:'out'}]});
 assert.ok(windy.estimatedUnderProbability>calm.estimatedUnderProbability);
 assert.equal(windy.eligibleForAutomation,false);
});
test('trailing exit policy adapts to volatility without discarding stop protection',()=>{
 const a=adaptiveExitThresholds({volatilityPct:2}),b=adaptiveExitThresholds({volatilityPct:16});
 assert.ok(b.trailingPercent>a.trailingPercent);
 assert.ok(b.stopLossPercent<=15);
});
