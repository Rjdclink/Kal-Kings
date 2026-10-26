import test from 'node:test';
import assert from 'node:assert/strict';
import {cryptoConsensus,planDirectionalTrade,assessLateGame,assessTotals} from './predictive_strategies.mjs';
const now=Date.parse('2026-10-26T12:00:00.000Z');
const tick=(source,start,last,age=1000)=>({source,symbol:'BTC',start,last,observedAt:new Date(now-age).toISOString()});
const base=[tick('coinbase',80000,80300),tick('kraken',80010,80320),tick('bitstamp',79990,80280)];
test('three independent fresh spot markets can agree on an upward trend',()=>{
 const a=cryptoConsensus(base,{symbol:'BTC',now,minSources:3});
 assert.equal(a.direction,'UP');assert.equal(a.agreeingSources,3);assert.equal(a.action,'SIGNAL_ONLY');
});
test('duplicates and stale sources do not create artificial majority',()=>{
 const a=cryptoConsensus([base[0],base[0],base[1],tick('bitstamp',80000,80300,45000)],{symbol:'BTC',now,minSources:3});
 assert.equal(a.direction,'UNKNOWN');assert.equal(a.sources,2);
});
test('opposing observations and materially mismatched spot prices are rejected',()=>{
 const a=cryptoConsensus([base[0],base[1],tick('bitstamp',79990,79500)],{symbol:'BTC',now,minSources:3});
 assert.equal(a.direction,'UNKNOWN');
 const b=cryptoConsensus([base[0],base[1],tick('bitstamp',70000,70400)],{symbol:'BTC',now,minSources:3});
 assert.equal(b.reason,'PRICE_DISAGREEMENT');
});
const contract={ticker:'KXBTC15M-26OCT261200-00',seriesTicker:'KXBTC15M',symbol:'BTC',status:'open',
  rulesPrimary:"If the simple average of the sixty seconds of CF Benchmarks' BRTI before expiration is at least the average before opening then resolves to Yes.",
  closeTime:new Date(now+4*60000).toISOString(),observedAt:new Date(now-1000).toISOString(),
  yesAsk:.66,noAsk:.35,yesDepth:50,noDepth:50};
test('consensus alone never silently authorizes money orders',()=>{
 const c=cryptoConsensus([...base,tick('gemini',80000,80300),tick('okx',80000,80310)],{symbol:'BTC',now});
 const d=planDirectionalTrade({consensus:c,market:contract,bankroll:15,feePerContract:.03,now});
 assert.equal(d.allowed,false);assert.equal(d.reason,'INDEPENDENT_PROBABILITY_NOT_VALIDATED');
});
test('a validated risk model can approve an affordable correctly mapped directional contract',()=>{
 const c=cryptoConsensus([...base,tick('gemini',80000,80300),tick('okx',80000,80310)],{symbol:'BTC',now});
 const model={validated:true,probability:.91,sampleCount:150,holdoutCount:45,symbol:'BTC',direction:'UP',horizonMinutes:15,settlementBasis:'CF_BENCHMARKS_RTI',validatedAt:new Date(now-1000).toISOString()};
 const d=planDirectionalTrade({consensus:c,market:contract,bankroll:15,feePerContract:.03,model,now});
 assert.equal(d.allowed,true);assert.equal(d.side,'yes');assert.equal(d.contracts,4);
});
test('no direction mismatch or stale quote may authorize an order',()=>{
 const c=cryptoConsensus([...base,tick('gemini',80000,80300),tick('okx',80000,80310)],{symbol:'BTC',now});
 const model={validated:true,probability:.91,sampleCount:150,holdoutCount:45,symbol:'BTC',direction:'UP',horizonMinutes:15,settlementBasis:'CF_BENCHMARKS_RTI',validatedAt:new Date(now-1000).toISOString()};
 assert.equal(planDirectionalTrade({consensus:c,market:{...contract,seriesTicker:'KXETH15M'},bankroll:15,feePerContract:.03,model,now}).allowed,false);
 assert.equal(planDirectionalTrade({consensus:c,market:{...contract,observedAt:new Date(now-60000).toISOString()},bankroll:15,feePerContract:.03,model,now}).allowed,false);
});
test('a commanding late lead is detected without claiming guaranteed value',()=>{
 const d=assessLateGame({sport:'NFL',home:'Philadelphia Eagles',away:'Dallas Cowboys',homeScore:31,awayScore:10,period:4,clockSeconds:210,state:'in',updatedAt:new Date(now-1000).toISOString(),now});
 assert.equal(d.direction,'Philadelphia Eagles');assert.equal(d.action,'REVIEW_ONLY');
});
test('pre-game, unverified, or stale score is rejected',()=>{
 const d=assessLateGame({sport:'NFL',home:'Philadelphia',away:'Dallas',homeScore:31,awayScore:10,period:4,clockSeconds:210,state:'pre',updatedAt:new Date(now-1000).toISOString(),now});
 assert.equal(d.direction,null);
});
test('weather and known injuries inform totals signals but never manufacture win probability',()=>{
 const d=assessTotals({sport:'NFL',totalLine:43.5,homeScore:10,awayScore:3,period:2,clockSeconds:300,state:'in',weather:{windMph:22,gustMph:31,indoor:false},injuries:[{team:'home',role:'QB',status:'out'}],updatedAt:new Date(now-1000).toISOString(),now});
 assert.equal(d.direction,'UNDER');assert.equal(d.eligibleForAutomation,false);
 assert.ok(d.factors.some(s=>/wind/i.test(s)));
});
test('wind does not influence indoor-game analysis',()=>{
 const d=assessTotals({sport:'NFL',totalLine:43.5,homeScore:10,awayScore:3,period:2,clockSeconds:300,state:'in',weather:{windMph:40,indoor:true},injuries:[],updatedAt:new Date(now-1000).toISOString(),now});
 assert.equal(d.direction,null);
});

test('five of seven verified independent markets qualifies at twenty percent allocation',()=>{
 const rows=[...base,tick('gemini',80005,80305),tick('okx',80010,80302),
  tick('kucoin',80000,79700),tick('bitfinex',80000,79700)];
 const c=cryptoConsensus(rows,{symbol:'BTC',now});
 assert.equal(c.direction,'UP');assert.equal(c.agreeingSources,5);
 assert.equal(c.sources,7);assert.equal(c.allocationFraction,.2);
});
test('six and seven consistent quotes assign thirty and forty percent allocation ceilings',()=>{
 const names=['coinbase','kraken','bitstamp','gemini','okx','kucoin','bitfinex'];
 const rows=names.map((name,i)=>tick(name,80000,80300+i));
 const six=cryptoConsensus(rows.map((r,i)=>i===6?{...r,last:79700}:r),{symbol:'BTC',now});
 assert.equal(six.direction,'UP');assert.equal(six.agreeingSources,6);
 assert.equal(six.allocationFraction,.3);
 const seven=cryptoConsensus(rows,{symbol:'BTC',now});
 assert.equal(seven.agreeingSources,7);assert.equal(seven.allocationFraction,.4);
});
test('four of seven observations cannot pass a five-vote execution majority',()=>{
 const names=['coinbase','kraken','bitstamp','gemini'];
 const result=cryptoConsensus(names.map((n,i)=>tick(n,80000,80300+i)),{symbol:'BTC',now});
 assert.equal(result.direction,'UNKNOWN');assert.equal(result.allocationFraction,0);
});

test('small-price crypto consensus keeps meaningful price decimals',()=>{
 const names=['coinbase','kraken','bitstamp','gemini','okx'];
 const rows=names.map((source,i)=>({source,symbol:'DOGE',start:.089,last:.0924+i*.00001,observedAt:new Date(now).toISOString()}));
 const c=cryptoConsensus(rows,{symbol:'DOGE',now});
 assert.equal(c.agreeingSources,5);
 assert.ok(Math.abs(c.medianPrice-.09242)<.00001);
});

test('fresh Monte Carlo crypto model requires no arbitrary 100 training / 30 holdout samples',()=>{
 const five=[...base,tick('gemini',80000,80305),tick('okx',80000,80300)];
 const c=cryptoConsensus(five,{symbol:'BTC',now});
 const forecast={status:'ESTIMATED',symbol:'BTC',direction:'UP',
   probability:.94,observedAt:new Date(now-1000).toISOString(),
   settlementBasis:'CF_BENCHMARKS_RTI',horizonMinutes:15};
 const r=planDirectionalTrade({consensus:c,market:contract,bankroll:15,
   feePerContract:.02,model:forecast,now});
 assert.equal(r.allowed,true);
 assert.equal(r.side,'yes');
 assert.ok(r.expectedNetDollars>.02);
});

test('six small same-direction moves count as six votes, with profitability checked separately',()=>{const returns=[-.00001,-.02241,-.0076,-.02361,-.02512,-.04388,-.0485];const names=['coinbase','kraken','bitstamp','gemini','okx','kucoin','bitfinex'];const quotes=names.map((source,i)=>tick(source,80000,80000*(1+returns[i]/100)));const result=cryptoConsensus(quotes,{symbol:'BTC',now});assert.equal(result.direction,'DOWN');assert.equal(result.agreeingSources,6);assert.equal(result.allocationFraction,.3)});
