import test from 'node:test';
import assert from 'node:assert/strict';
import {assessKalshiValue} from './strategy_optimizer.mjs';
const now=Date.parse('2026-10-26T15:00:00Z');
const market={ticker:'KXBTC15M-26OCT261515-15',status:'active',observedAt:new Date(now).toISOString(),yesAsk:.20,yesDepth:50};
const base={market,side:'yes',probability:.55,probabilitySource:'CRYPTO_SCENARIO_PROXY',sourceVerified:true,marketMatchVerified:true,bankroll:20,holdings:[],feePerContract:.01,maxLossProbability:.30,minimumEdge:.02,maxBankrollFraction:.40,now};
test('final crypto approval uses 7-of-7 consensus-adjusted confidence for eligibility but raw model probability for expected profit',()=>{
 const approved=assessKalshiValue({...base,consensusConfidenceScorePercent:85});
 assert.equal(approved.allowed,true);assert.equal(approved.modeledWinProbability,.55);
 assert.ok(approved.expectedNetDollars>0);
 const rejected=assessKalshiValue({...base,market:{...market,yesAsk:.70},consensusConfidenceScorePercent:85});
 assert.equal(rejected.allowed,false); // Price higher than raw probability must still fail.
});
test('4-of-7 consensus monitor score cannot buy even with positive raw expected edge',()=>{
 assert.equal(assessKalshiValue({...base,consensusConfidenceScorePercent:65}).allowed,false);
});
