import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLiveKalshiEntry, historyForExit, summarizeQuantState,MAX_MODELED_LOSS_FREQUENCY} from './quant_runtime.mjs';
const at=new Date('2026-10-24T20:20:00Z').toISOString();
const market={id:'KXNFLGAME-TEST-BUF',yesAsk:.37,noAsk:.38,yesDepth:10,noDepth:10,observedAt:at};
const crossed={orderbook_fp:{yes_dollars:[['0.64','10.00']],no_dollars:[['0.64','10.00']]}};
const base={quote:market,bookResponse:crossed,bankroll:100,now:Date.parse(at),holdings:[],positionsComplete:true,history:[],executions:[]};
test('live entry uses actual book depth, not indicative quote prices, and reports Monte Carlo provenance',()=>{
 const result=assessLiveKalshiEntry(base);
 assert.ok(result.candidate);assert.equal(result.candidate.yesPrice,.36);
 assert.equal(result.candidate.noPrice,.36);
 assert.ok(result.candidate.count>=1);
 assert.equal(result.model?.mode,'SIMULATION_ONLY');
 assert.equal(result.calibration?.status,'INSUFFICIENT_EXECUTIONS');
 assert.equal(result.backtest?.status,'INSUFFICIENT_HISTORY');
 assert.equal(typeof result.accepted,'boolean');
});
test('fails closed when historical exposure inventory is incomplete',()=>{
 const r=assessLiveKalshiEntry({...base,positionsComplete:false});
 assert.equal(r.accepted,false);assert.equal(r.reason,'INCOMPLETE_HOLDINGS');
});
test('blocks quote book with no actual opposing side',()=>{
 const r=assessLiveKalshiEntry({...base,bookResponse:{orderbook_fp:{yes_dollars:[['.64','10']],no_dollars:[]}}});
 assert.equal(r.accepted,false);assert.ok(['INSUFFICIENT_DEPTH','NO_POSITIVE_SPREAD'].includes(r.reason));
});
test('no execution if proposed order is unaffordable by exchange cash',()=>{
 const r=assessLiveKalshiEntry({...base,bankroll:.05});
 assert.equal(r.accepted,false);assert.equal(r.reason,'NO_AFFORDABLE_CONTRACT');
});
test('correlated existing position blocks adding to the same event',()=>{
 const r=assessLiveKalshiEntry({...base,holdings:[{ticker:'KXNFLGAME-TEST-CHI',position:4}]});
 assert.equal(r.accepted,false);assert.equal(r.reason,'CORRELATED_EVENT_EXPOSURE');
});
test('replays ordered bid history without using future timestamps',()=>{
 const t=Date.parse(at);const history=Array.from({length:20},(_,i)=>({observedAt:new Date(t-(20-i)*60000).toISOString(),bid:.35+i*.005,ask:.37+i*.005}));
 assert.equal(historyForExit(history,t).length,20);
 assert.equal(historyForExit([...history,{observedAt:new Date(t+3600000).toISOString(),bid:.99,ask:.99}],t).length,20);
});
test('quant diagnostics never label absent calibration as live verified accuracy',()=>{
 const state=summarizeQuantState({historySamples:0,executionSamples:0,decisions:[]});
 assert.equal(state.confidence,'UNCALIBRATED');assert.equal(state.verifiedExpectedProfit,null);
});

test('modeled loss-frequency ceiling is 30 percent',()=>{assert.equal(MAX_MODELED_LOSS_FREQUENCY,.30)});

test('the global Monte Carlo modeled loss-frequency ceiling is raised to 30 percent',()=>{
 assert.equal(MAX_MODELED_LOSS_FREQUENCY,.30);
});
