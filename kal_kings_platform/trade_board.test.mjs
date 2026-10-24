import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTradeBoard,executionSummary,bankrollTradeStatus} from './trade_board.mjs';

test('trade board prioritizes positive verified net profit and caps actionable entries at ten',()=>{
 const verified=Array.from({length:12},(_,i)=>({id:`review-${i}`,event:`Game ${i}`,selection:'Home',dkAmerican:110,dkStake:10,kalshiTicker:`KX-${i}`,kalshiSide:'yes',kalshiAsk:.4,contracts:20,minimumProfit:i+1,monteCarlo:{expectedProfit:i+.5,meanWorst5Percent:-1}}));
 const board=buildTradeBoard({opportunities:verified,signals:[],priceGaps:[],favorites:[]});
 assert.equal(board.eligible.length,10);
 assert.deepEqual(board.eligible.map(x=>x.expectedProfit),Array.from({length:10},(_,i)=>12-i));
 assert.ok(board.eligible.every(x=>x.action==='PREPARE_DRAFTKINGS'&&x.label==='Conditionally profitable'));
});

test('unverified comparison signals and favorites never acquire executable/profitable badges',()=>{
 const board=buildTradeBoard({opportunities:[],signals:[{id:'s',event:'Example',expectedProfitDollars:40,mode:'MODEL_REFERENCE_ONLY',marketPrice:.4,kalshiTicker:'KX'}],
 priceGaps:[{event:'Spread',priceGapPercentagePoints:20,marketA:'Kalshi',marketB:'DraftKings',priceA:.3,priceB:.5}],favorites:[{event:'Likely winner',selection:'A',marketImpliedConfidence:97}]});
 assert.equal(board.eligible.length,0);
 assert.ok(board.review.length>0);
 assert.ok(board.review.every(x=>!x.executable&&x.action==='REVIEW_ONLY'&&x.expectedProfit===null));
});

test('execution summary counts actual confirmed fills separately from pending/rejected and ignores unfilled in pnl',()=>{
 const o=[{ticker:'A',status:'FILLED',filled:3,count:3,price:.5},{ticker:'B',status:'PARTIALLY_FILLED',filled:1,count:5,price:.5},{ticker:'C',status:'NOT_FILLED',filled:0,count:1,price:.5},{ticker:'D',status:'UNKNOWN',filled:0,count:2,price:.5},{ticker:'E',status:'REJECTED',filled:0,count:1,price:.5}];
 const s=executionSummary(o);
 assert.equal(s.orderAttempts,5);
 assert.equal(s.executedOrders,2);
 assert.equal(s.confirmedFilledContracts,4);
 assert.equal(s.outstandingUnknown,1);
 assert.equal(s.totalProfit,null);
});

test('five cents without a verified match never attempts a trade',()=>{
 const v=bankrollTradeStatus({balance:.05,opportunities:[],riskPolicy:{hardLossLimitDollars:0,riskPercent:.75}});
 assert.equal(v.funded,true);
 assert.equal(v.tradeReady,false);
 assert.equal(v.reason,'NO_EXECUTABLE_MATCH');
});

test('tiny funded account awaits qualified prices, not an arbitrary one-cent percentage cutoff',()=>{
 const v=bankrollTradeStatus({balance:.05,opportunities:[],riskPolicy:{hardLossLimitDollars:.000375,riskPercent:.75}});
 assert.equal(v.funded,true);
 assert.equal(v.reason,'NO_EXECUTABLE_MATCH');
 assert.equal(v.tradeReady,false);
});
