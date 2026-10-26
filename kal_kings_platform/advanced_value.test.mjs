import test from 'node:test';
import assert from 'node:assert/strict';
import {matchSportsOutcome,assessKalshiValue,rankStrategies,assessTotalsProjection,adaptiveExitThresholds,bidVolatilityPct} from './strategy_optimizer.mjs';
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

test('adaptive stop volatility is measured from observed executable bids rather than a fixed guess',()=>{const rows=[.75,.74,.70,.69,.73,.67].map((bid,i)=>({bid,observedAt:new Date(Date.parse('2026-10-26T12:00:00Z')+i*1000).toISOString()}));assert.ok(bidVolatilityPct(rows)>0);assert.equal(bidVolatilityPct(rows.slice(0,2)),null)});

test('clinched live totals can rank without fictitious model-loss percentages',()=>{
 const candidate={id:'total',eventKey:'game-total',strategy:'TOTAL_ALREADY_OVER',allowed:true,
   conditionalOutcomeVerified:true,modeledLossFrequency:null,expectedNetDollars:.08,
   estimatedMaxDebitDollars:.9};
 assert.equal(rankStrategies([candidate]).length,1);
 assert.equal(rankStrategies([{...candidate,conditionalOutcomeVerified:false}]).length,0);
});

test('independently verified fractional positive value is considered despite old two-cent floor',()=>{
 const q={...market,yesAsk:.88,yesDepth:3};
 const v=assessKalshiValue({market:q,side:'yes',probability:.9,
   sourceVerified:true,marketMatchVerified:true,probabilitySource:'ESPN_LIVE_MODEL',
   bankroll:15,holdings:[],feePerContract:.015,now:NOW});
 assert.equal(v.allowed,true);
 assert.ok(v.expectedNetDollars>0);
});
test('flat or negative independently modeled net value cannot qualify',()=>{
 const v=assessKalshiValue({market:{...market,yesAsk:.89},
   side:'yes',probability:.9,sourceVerified:true,marketMatchVerified:true,
   probabilitySource:'ESPN_LIVE_MODEL',bankroll:15,holdings:[],feePerContract:.01,now:NOW});
 assert.equal(v.allowed,false);
});

test('crypto simulation uses five votes and 20 percent bankroll allocation without extra historical holdout gate',()=>{const m={ticker:'KXBTC15M-26OCT261415-15',status:'active',yesAsk:.40,yesDepth:20,observedAt:new Date(NOW).toISOString()};const r=assessKalshiValue({market:m,side:'yes',probability:.94,probabilitySource:'CRYPTO_SCENARIO_PROXY',sourceVerified:true,marketMatchVerified:true,bankroll:15,holdings:[],feePerContract:.01,minimumEdge:.02,maxBankrollFraction:.2,now:NOW});assert.equal(r.allowed,true);assert.equal(r.contracts,7);assert.ok(r.estimatedMaxDebitDollars<=3)});

test('positive expected value at 78 percent may trade under raised 30 percent modeled-loss ceiling',()=>{
 const quote={...market,yesAsk:.45,yesDepth:20};
 const d=assessKalshiValue({market:quote,side:'yes',probability:.78,probabilitySource:'ESPN_LIVE_MODEL',
  sourceVerified:true,marketMatchVerified:true,bankroll:15,holdings:[],
  feePerContract:.02,maxLossProbability:.30,now:NOW});
 assert.equal(d.allowed,true);assert.ok(d.expectedNetDollars>0);
});
test('30 percent modeled loss cap still blocks forecasts below 70 percent even with cheap prices',()=>{
 const d=assessKalshiValue({market:{...market,yesAsk:.20},side:'yes',probability:.69,
  probabilitySource:'CRYPTO_SCENARIO_PROXY',sourceVerified:true,marketMatchVerified:true,
  bankroll:15,holdings:[],feePerContract:.02,maxLossProbability:.30,
  minimumEdge:.02,maxBankrollFraction:.2,now:NOW});
 assert.equal(d.allowed,false);
});
test('ranked sports can include positive expected value with a quarter modeled loss frequency',()=>{
 const idea={eventKey:'another',allowed:true,expectedNetDollars:.12,estimatedMaxDebitDollars:.45,modeledLossFrequency:.25};
 assert.equal(rankStrategies([idea]).length,1);
});
