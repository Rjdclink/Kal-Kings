import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKalshiBook, sweepAsks, optimizePairedDepth, portfolioExposureGate,
 simulateSequentialFills, walkForwardCalibration, monteCarloExitDecision,
 evaluateRiskAdjustedEntry, executionFillCalibration, snapshotBacktest} from './quant.mjs';
const book={orderbook_fp:{yes_dollars:[['0.40','5.00'],['0.42','8.00']],no_dollars:[['0.42','2.00'],['0.44','3.00'],['0.48','5.00']]}};
test('turn actual yes/no bids into sorted executable asks, not a fictitious ask book',()=>{
 const b=normalizeKalshiBook(book);
 assert.deepEqual(b.yesAsks.map(x=>x.price),[.52,.56,.58]);
 assert.deepEqual(b.noAsks.map(x=>x.price),[.58,.6]);
 assert.deepEqual(b.yesBids.map(x=>x.price),[.42,.4]);
});
test('sweep contracts through multiple levels and reject insufficient displayed depth',()=>{
 const b=normalizeKalshiBook(book);
 assert.equal(sweepAsks(b.yesAsks,4).cost, 4*.52);
 assert.equal(sweepAsks(b.yesAsks,6).cost,5*.52+.56);
 assert.equal(sweepAsks(b.yesAsks,11),null);
});
test('quote pair optimizer takes fee and changing book depth into account',()=>{
 const favorable={orderbook_fp:{yes_dollars:[['.53','3.00'],['.54','2.00']],no_dollars:[['.58','1.00'],['.60','2.00'],['.61','1.00']]}};
 const b=normalizeKalshiBook(favorable);
 const cand=optimizePairedDepth({ticker:'KXFOO-TEST',book:b,balance:10,maxCapital:10,minimumNet:0.01,slippagePerContract:.001});
 assert.ok(cand);
 assert.equal(cand.count,4);
 assert.ok(cand.requiredDollars<10);
 assert.ok(cand.netProfitDollars>0);
 assert.ok(cand.yesPrice>0 && cand.noPrice>0);
});
test('bad orderbook and negative-spread books reject closed opportunities',()=>{
 assert.throws(()=>normalizeKalshiBook({orderbook_fp:{yes_dollars:[['0.45','NaN']],no_dollars:[]}}));
 assert.equal(optimizePairedDepth({ticker:'KXFOO-TEST',book:normalizeKalshiBook(book),balance:100,maxCapital:100}),null);
});
test('portfolio risk prevents adding correlated event risk and unknown position risk',()=>{
 const b=portfolioExposureGate({cashAvailable:20,maxRiskDollars:2,orphanLossDollars:.75,eventKey:'NFL-TEAM',holdings:[{ticker:'NFL-TEAM-A',position:'2'}]});
 assert.equal(b.accepted,false);assert.equal(b.reason,'CORRELATED_EVENT_EXPOSURE');
 const ok=portfolioExposureGate({cashAvailable:20,maxRiskDollars:2,orphanLossDollars:.75,eventKey:'NFL-TEAM',holdings:[{ticker:'NBA-OTHER-A',position:1}]});
 assert.equal(ok.accepted,true);
 const unknown=portfolioExposureGate({cashAvailable:20,maxRiskDollars:2,orphanLossDollars:.75,eventKey:'NFL-TEAM',holdings:[{ticker:'NFL-TEAM-A',position:'wat'}]});
 assert.equal(unknown.accepted,false);
});
test('Monte Carlo sequential execution excludes no-fill from win/loss denominators',()=>{
 const mc=simulateSequentialFills({count:1,yesPrice:.40,noPrice:.55,yesFee:0,noFee:0,yesFillProbability:.5,noFillProbability:.75,trials:1500,seed:103});
 assert.equal(mc.trials,1500);assert.ok(mc.noFillTrials>0);
 assert.equal(mc.executedTrials+mc.noFillTrials,1500);
 assert.ok(mc.executionRate>0&&mc.executionRate<1);
 assert.ok(mc.partialOrUnhedgedRate>0);
 assert.ok(mc.meanWorst5Percent<=mc.meanPnl);
 assert.equal(mc.mode,'SIMULATION_ONLY');
});
test('execution calibration rejects tiny sample sizes and uses verified fill receipts only',()=>{
 assert.equal(executionFillCalibration([]).status,'INSUFFICIENT_EXECUTIONS');
 const rows=Array.from({length:30},(_,i)=>({count:1,yes_filled:i===0?'0':'1',no_filled:i>0 &&i<20?'1':'0',status:i===0?'NOT_FILLED':i<20?'HEDGED':'UNHEDGED'}));
 const x=executionFillCalibration(rows);
 assert.equal(x.status,'CALIBRATED');assert.ok(x.firstFillRate>.5&&x.secondFillRate>.4);
});
test('chronological backtest cannot use future settlement outcomes to calibrate past forecasts',()=>{
 const records=Array.from({length:60},(_,i)=>({observedAt:new Date(1700000000000+i*1000000).toISOString(),predicted:.8,outcome:i<42?1:0}));
 const x=walkForwardCalibration(records,{minTraining:30,minTest:10});
 assert.equal(x.status,'VALIDATED_HOLDOUT');assert.equal(x.trainingCount,42);assert.equal(x.holdoutCount,18);
 assert.ok(x.holdoutBrier>=0);assert.ok(x.calibratedBrier>=0);
 assert.equal(walkForwardCalibration(records.slice(0,10)).status,'INSUFFICIENT_HISTORY');
});
test('backtest of timestamped bid records reports sample count and no oracle-optimal claim',()=>{
 const start=1700000000000;
 const observations=Array.from({length:30},(_,i)=>({observedAt:new Date(start+i*60000).toISOString(),ask:.42+i*.002,bid:.4+i*.002}));
 const x=snapshotBacktest(observations,{entryFee:.005,exitFee:.005});
 assert.equal(x.status,'BACKTESTED');assert.ok(x.trades>0);assert.ok(x.holdoutTrades>0);
 assert.equal(snapshotBacktest(observations.slice(0,3)).status,'INSUFFICIENT_HISTORY');
});
test('Monte Carlo exit decision returns uncalibrated when there is no recent bid history',()=>{
 const x=monteCarloExitDecision({entryPrice:.4,currentBid:.49,quantity:1,observations:[]});
 assert.equal(x.status,'INSUFFICIENT_HISTORY');assert.equal(x.action,'UNKNOWN');
});
test('entry approval uses depth-based price and MC tail loss constraints; never guesses profitability',()=>{
 const candidate={count:1,yesPrice:.43,noPrice:.53,yesCost:.43,noCost:.53,yesFee:0,noFee:0,netProfitDollars:.04,requiredDollars:.96,orphanLossDollars:.53};
 const approved=evaluateRiskAdjustedEntry({candidate,freeCash:10,riskBudget:1,holdings:[],eventKey:'EVENT',history:[],fills:[],trials:800,seed:3});
 assert.equal(typeof approved.accepted,'boolean');assert.ok(approved.monteCarlo);
 const excluded=evaluateRiskAdjustedEntry({candidate,freeCash:.05,riskBudget:.01,holdings:[],eventKey:'EVENT',history:[],fills:[]});
 assert.equal(excluded.accepted,false);assert.equal(excluded.reason,'INSUFFICIENT_CASH');
});

test('portfolio-wide gross exposure cap rejects unrelated existing positions',()=>{
 const gate=portfolioExposureGate({cashAvailable:10,maxRiskDollars:3,maxTotalGrossExposure:4,orphanLossDollars:.5,eventKey:'KXNFLGAME-TEAM1',holdings:[{ticker:'KXNBAGAME-TEAM2',position:'5'}]});
 assert.equal(gate.accepted,false);assert.equal(gate.reason,'PORTFOLIO_GROSS_EXPOSURE');
});

test('historical settlement labels unavailable before holdout must not influence calibration',()=>{
 const time=Date.parse('2026-01-01T00:00:00Z');
 const records=Array.from({length:60},(_,i)=>({
   observedAt:new Date(time+i*3600000).toISOString(),predicted:.8,outcome:i%3===0?0:1,
   settledAt:new Date(time+(i<40?100: i+2)*3600000).toISOString()
 }));
 const report=walkForwardCalibration(records,{minTraining:30,minTest:10});
 assert.equal(report.status,'INSUFFICIENT_HISTORY');
});

test('capital optimizer rejects single-sided or illiquid book and never rounds beyond available funds',()=>{
 const b=normalizeKalshiBook({orderbook_fp:{yes_dollars:[['.63','12.00']],no_dollars:[]}});
 assert.equal(optimizePairedDepth({ticker:'KXABC-123',book:b,balance:200,maxCapital:200}),null);
 const s=normalizeKalshiBook({orderbook_fp:{yes_dollars:[['.60','5.00']],no_dollars:[['.60','5.00']]}});
 const c=optimizePairedDepth({ticker:'KXABC-123',book:s,balance:1,maxCapital:1});
 assert.ok(c==null||c.requiredDollars<=1);
});

test('simulation never promotes uncalibrated execution estimates as verified statistics',()=>{
 const r=evaluateRiskAdjustedEntry({candidate:{marketTicker:'KXABC-123',count:1,yesPrice:.39,noPrice:.52,yesFee:0,noFee:0,requiredDollars:.91,orphanLossDollars:.52},freeCash:25,riskBudget:2,holdings:[],trials:1000});
 assert.equal(r.calibration?.status,'INSUFFICIENT_EXECUTIONS');
 assert.notEqual(r.calibration?.status,'CALIBRATED');
});

// Fee models must bound actual per-fill fees when the matched price improves
// inside the quoted limit, particularly near 50c where taker fees peak.
test('order-book cost bound includes worst taker fee at price-improved fills',()=>{
 const book={yesAsks:[{price:.46,quantity:1},{price:.65,quantity:4}],noAsks:[{price:.05,quantity:10}]};
 const candidate=optimizePairedDepth({ticker:'KXFEE-TEST',book,balance:15,maxCapital:15,maxContracts:3,minimumNet:0,slippagePerContract:0});
 assert.ok(candidate);assert.equal(candidate.count,3);
 assert.equal(candidate.yesPrice,.65);
 assert.ok(candidate.yesFee>=.06,'fee upper bound must use peak p(1-p) across executable range');
});

test('a valid one-sided Kalshi book remains tradable for that one side',()=>{const b=normalizeKalshiBook({orderbook_fp:{yes_dollars:null,no_dollars:[['.4500','3.00']]}});assert.equal(b.yesAsks.length,1);assert.equal(b.noAsks.length,0);assert.equal(b.yesAsks[0].price,.55)});
