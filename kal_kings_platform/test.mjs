import test from 'node:test';
import assert from 'node:assert/strict';
import {americanToDecimal, evaluatePair, monteCarlo, rankCandidates, quoteAge, suggestSimilarMarkets} from './engine.mjs';

test('American odds correctly converted', () => {
  assert.equal(americanToDecimal(110), 2.1);
  assert.equal(americanToDecimal(-200), 1.5);
  assert.throws(() => americanToDecimal(30));
});
test('Paired trade calculates both outcomes, including fees', () => {
  const p=evaluatePair({contracts:210, kalshiAsk:.45, dkStake:100, dkAmerican:110, feeUSD:0, reviewed:true, sameResolution:true, dkAccepted:true});
  assert.equal(p.minimumProfit,15.5);
  assert.equal(p.kalshiWins,15.5);
  assert.equal(p.draftKingsWins,15.5);
  assert.equal(p.executableArbitrage,true);
});
test('No approved settlement review implies not executable', () => {
  const p=evaluatePair({contracts:210,kalshiAsk:.45,dkStake:100,dkAmerican:110,feeUSD:0,reviewed:false,sameResolution:false,dkAccepted:false});
  assert.equal(p.executableArbitrage,false);
  assert.equal(p.positiveQuotedSpread,true);
});
test('MC with guaranteed second leg fill yields no losses when priced positive', () => {
  const p=evaluatePair({contracts:210,kalshiAsk:.45,dkStake:100,dkAmerican:110,feeUSD:0});
  const mc=monteCarlo(p,{trials:1000,secondLegFillProbability:1});
  assert.equal(mc.lossFrequency,0);
  assert.equal(mc.p05,15.5);
});
test('MC with failed hedge can lose principal', () => {
  const p=evaluatePair({contracts:210,kalshiAsk:.45,dkStake:100,dkAmerican:110,feeUSD:0});
  const mc=monteCarlo(p,{trials:1000,secondLegFillProbability:0});
  assert.ok(mc.lossFrequency > 40);
  assert.ok(mc.p05 < 0);
});
test('Rank only qualifies reviewed, funded, fresh, economically positive pairs', () => {
  const rows=[{id:'real',reviewed:true,sameResolution:true,fresh:true,funded:true,minimumProfit:8},{id:'fake',reviewed:false,sameResolution:true,fresh:true,funded:true,minimumProfit:999}, {id:'negative',reviewed:true,sameResolution:true,fresh:true,funded:true,minimumProfit:-8}];
  assert.deepEqual(rankCandidates(rows).map(x=>x.id),['real']);
});
test('Fuzzy matching never constitutes equivalence', () => {
  assert.equal(suggestSimilarMarkets('Dallas Cowboys vs Philadelphia Eagles','Dallas Cowboys at Philadelphia Eagles'),true);
  const p=evaluatePair({contracts:2,kalshiAsk:.2,dkStake:1,dkAmerican:400});
  assert.equal(p.executableArbitrage,false);
});
test('Quote staleness detected',()=>{
  assert.equal(quoteAge({updatedAt:'2026-01-01T00:00:00Z'},Date.parse('2026-01-01T00:00:03Z')),3000);
  assert.equal(quoteAge({}),Infinity);
});

test('an unexecuted two-leg simulation never counts as profit, loss or success',()=>{
  const pair=evaluatePair({contracts:10,kalshiAsk:.45,dkStake:5,dkAmerican:110,feeUSD:0});
  const r=monteCarlo(pair,{trials:500,firstLegFillProbability:0,secondLegFillProbability:0});
  assert.equal(r.executedTrials,0);
  assert.equal(r.expectedProfit,null);
  assert.equal(r.lossFrequency,null);
  assert.equal(r.noFillTrials,500);
});
