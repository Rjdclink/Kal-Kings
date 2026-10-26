import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleForecast,recordForecasts,resolveForecasts,getStrategyPerformance} from './strategy_history.mjs';
const data={id:'game',sourceVerified:true,marketMatchVerified:true,modelPlayId:'ESPN-1',
 market:{ticker:'KXNFLGAME-26OCT26DALPHI-PHI',yesAsk:.75},externalWinProbability:.9,eventKey:'NFL:DALPHI'};
test('verified live-game forecast is recorded once with actual market ask',async()=>{
 let rows=[];const sql=async(q,p)=>{rows.push({q,p});return []};
 assert.equal(eligibleForecast(data),true);
 await recordForecasts(sql,[data,{...data,sourceVerified:false}]);
 assert.equal(rows.length,1);
 assert.equal(rows[0].p[2],'.9');
});
test('only venue-verified settled results receive an outcome label',async()=>{
 const calls=[];const sql=async(q,p)=>{calls.push({q,p});return q.includes('SELECT market_ticker')?[{market_ticker:data.market.ticker}]:[]};
 const count=await resolveForecasts(sql,async()=>({status:'settled',result:'yes'}));
 assert.equal(count,1);assert.equal(calls[1].p[1],true);
});
test('performance never invents a win rate before confirmed settlements',async()=>{
 const sql=async(q)=>q.includes('GROUP BY status')?[]:[];
 const r=await getStrategyPerformance(sql);
 assert.equal(r.status,'INSUFFICIENT_RESOLVED_SAMPLE');assert.equal(r.recordedSettlements,0);
});
