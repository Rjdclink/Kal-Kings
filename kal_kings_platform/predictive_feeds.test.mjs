import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCryptoSignals,spotMomentum,normalizeScoreboard,fetchSportsSignals,calculateCryptoWindowReference} from './predictive_feeds.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const epoch=Math.floor(now/1000);
const ohlc=[
 [epoch-900,1,1,100,101,1],
 [epoch-600,1,1,101,102,1],
 [epoch-300,1,1,102,103,1],
 [epoch,1,1,103,104,1]
];
const market={ticker:'KXBTC15M-26OCT261210-10',status:'open',yes_ask_dollars:'0.6800',no_ask_dollars:'0.3300',yes_ask_size_fp:'12.00',no_ask_size_fp:'8.00',close_time:new Date(now+10*60000).toISOString(),rules_primary:"The sixty seconds CF Benchmarks BRTI average before expiry compared to the average at least as high before the window started."};
const mockFetch=async url=>{
 let value;
 if(url.includes('coinbase.com'))value=ohlc;
 else if(url.includes('kraken.com'))value={error:[],result:{XXBTZUSD:ohlc.map(v=>[v[0],String(v[3]),'110','90',String(v[4]),'100','2',1])}};
 else if(url.includes('bitstamp.net'))value={data:{ohlc:ohlc.map(v=>({timestamp:String(v[0]),open:String(v[3]),close:String(v[4])}))}};
 else if(url.includes('api.gemini.com'))value=ohlc.map(v=>[v[0]*1000,v[3],110,90,v[4],1]);
 else if(url.includes('www.okx.com'))value={code:'0',data:ohlc.map(v=>[String(v[0]*1000),String(v[3]),'110','90',String(v[4]),'1'])};
 else if(url.includes('api.kucoin.com'))value={code:'200000',data:ohlc.map(v=>[String(v[0]),String(v[3]),String(v[4]),'110','90','1'])};
 else if(url.includes('api-pub.bitfinex.com'))value=ohlc.map(v=>[v[0]*1000,v[3],v[4],110,90,1]);
 else if(url.includes('kalshi.com'))value={events:[{event_ticker:'KXBTC15M-26OCT261210',markets:[market]}]};
 else throw Error('Unexpected URL: '+url);
 return {ok:true,json:async()=>value};
};
test('crypto spot and directional Kalshi market are collected without claiming an order',async()=>{
 const r=await fetchCryptoSignals({fetcher:mockFetch,now,symbols:['BTC']});
 assert.equal(r.length,1);assert.equal(r[0].direction,'UP');
 assert.equal(r[0].sources,7);assert.equal(r[0].agreeingSources,7);
 assert.equal(r[0].allocationFraction,.4);assert.equal(r[0].marketTicker,market.ticker);
 assert.equal(r[0].allowed,false);
});
test('market consensus cannot be manufactured from one available API',async()=>{
 const fetcher=async url=>{if(!url.includes('coinbase.com')&&!url.includes('kalshi.com'))throw Error('service unavailable');return mockFetch(url)};
 const r=await fetchCryptoSignals({fetcher,now,symbols:['BTC']});
 assert.equal(r[0].direction,'UNKNOWN');assert.equal(r[0].allowed,false);
});
test('live sports lead and over/under context use ESPN scores and known injury status',async()=>{
 const scoreboard={events:[{id:'1',name:'Dallas at Philadelphia',status:{type:{state:'in'},period:4,clock:240},competitions:[{
   competitors:[{homeAway:'home',score:'31',team:{id:'1',displayName:'Philadelphia Eagles'}},{homeAway:'away',score:'10',team:{id:'2',displayName:'Dallas Cowboys'}}],
   venue:{indoor:false,address:{city:'Philadelphia',state:'PA'}},odds:[{overUnder:43.5}]}]}]};
 const rows=normalizeScoreboard(scoreboard,'NFL',now);
 assert.equal(rows.length,1);assert.equal(rows[0].lateGame.direction,'Philadelphia Eagles');
 assert.equal(rows[0].totals.eligibleForAutomation,false);
});

test('Kalshi API active market status remains an eligible live matching contract',async()=>{
 const liveFetch=async url=>{
   const r=await mockFetch(url);
   if(!url.includes('kalshi.com'))return r;
   return {ok:true,json:async()=>({events:[{markets:[{...market,status:'active'}]}]})};
 };
 const result=await fetchCryptoSignals({fetcher:liveFetch,now,symbols:['BTC']});
 assert.equal(result[0].marketTicker,market.ticker);
});

import {parseLiveWinProbability,selectSportsMarket} from './predictive_feeds.mjs';
test('external win probability requires the exact live ESPN event and latest play',()=>{
 const event={id:'GAME-1',date:'2026-10-26T23:00:00Z',competitions:[{situation:{lastPlay:{id:'PLAY-55'}}}]};
 const summary={header:{id:'GAME-1'},winprobability:[{homeWinPercentage:.94,tiePercentage:0,playId:'PLAY-55'}]};
 const good=parseLiveWinProbability(summary,event);
 assert.equal(good.sourceVerified,true);assert.equal(good.homeProbability,.94);
 assert.equal(parseLiveWinProbability(summary,{...event,id:'WRONG'}).sourceVerified,false);
 assert.equal(parseLiveWinProbability(summary,{...event,competitions:[{situation:{lastPlay:{id:'PLAY-56'}}}]}).sourceVerified,false);
});
test('only same exact date and teams select a Kalshi sports outcome',()=>{
 const markets=[{ticker:'KXNFLGAME-26OCT26DALPHI-PHI',yesAsk:.75,noAsk:.26,status:'active'},
   {ticker:'KXNFLGAME-26OCT26NYGPHI-PHI',yesAsk:.5,noAsk:.51,status:'active'}];
 const data={sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',selectedAbbreviation:'PHI'};
 assert.equal(selectSportsMarket(data,markets).ticker,markets[0].ticker);
 assert.equal(selectSportsMarket({...data,awayAbbreviation:'SEA'},markets),null);
});

import {selectTotalsMarket,selectExceededTotalsMarkets} from './predictive_feeds.mjs';
test('total matching rejects other games',()=>{assert.equal(selectTotalsMarket({sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',totalLine:30},[]),null)});

test('exact NFL total line selects correct Kalshi market',()=>{const market={ticker:'KXNFLTOTAL-26OCT26DALPHI-30',status:'active',floorStrike:29.5,yesAsk:.91,rulesPrimary:'If Dallas and Philadelphia collectively score more than 29.5 points, resolves to Yes.'};const e={sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',totalLine:30};assert.equal(selectTotalsMarket(e,[market]).ticker,market.ticker)});

test('live scoreboard attaches exact market totals and scored outcome for execution evaluation',async()=>{
 const event={id:'g1',date:'2026-10-26T19:00:00Z',name:'Dallas Cowboys at Philadelphia Eagles',
  status:{type:{state:'in'},period:4,clock:250},
  competitions:[{competitors:[
   {homeAway:'home',score:'31',team:{id:'home1',abbreviation:'PHI',displayName:'Philadelphia Eagles'}},
   {homeAway:'away',score:'20',team:{id:'away1',abbreviation:'DAL',displayName:'Dallas Cowboys'}}],
   venue:{indoor:true,address:{city:'Philadelphia'}},odds:[{overUnder:44.5}]}]};
 const total={ticker:'KXNFLTOTAL-26OCT26DALPHI-44',status:'active',floor_strike:44.5,
  yes_ask_dollars:'0.89',no_ask_dollars:'0.12',yes_ask_size_fp:'10.00',
  close_time:new Date(now+300000).toISOString(),
  rules_primary:'If Dallas and Philadelphia collectively score more than 44.5 points, then market resolves to Yes.'};
 const fetcher=async url=>{
  let payload;
  if(url.endsWith('/scoreboard'))payload={events:[event]};
  else if(url.endsWith('/injuries'))payload={injuries:[]};
  else if(url.includes('KXNFLTOTAL'))payload={events:[{markets:[total]}]};
  else if(url.includes('KXNFLGAME'))payload={events:[]};
  else payload={events:[]};
  return {ok:true,json:async()=>payload};
 };
 const result=await fetchSportsSignals({fetcher,now,sports:['NFL']});
 assert.equal(result.length,1);
 assert.equal(result[0].totalMarket?.ticker,total.ticker);
 assert.equal(result[0].totalGame?.homeScore,31);
});

test('a live score above several Kalshi totals scans ALL qualifying thresholds, not one sportsbook line',()=>{
 const game={sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',
   awayAbbreviation:'DAL',homeScore:31,awayScore:20};
 const markets=[44.5,49.5,50.5,53.5].map((line,i)=>({
   ticker:'KXNFLTOTAL-26OCT26DALPHI-'+i,status:'active',
   floorStrike:line,yesAsk:.93+i*.01,noAsk:.09,
   yesDepth:8,closeTime:new Date(now+180000).toISOString(),
   rulesPrimary:'If Dallas and Philadelphia collectively score more than '+line+
      ' points in the game, then market resolves to Yes.'}));
 const out=selectExceededTotalsMarkets(game,markets,{now});
 assert.equal(out.length,3);
 assert.ok(out.every(x=>x.floorStrike<51));
 assert.equal(selectExceededTotalsMarkets({...game,awayAbbreviation:'NYG'},markets,{now}).length,0);
});

test('official Kalshi markets endpoint supplies actionable YES and NO quotes even if nested events are unavailable',async()=>{
 const fetcher=async url=>{
   if(url.includes('/trade-api/v2/markets?')){
     return {ok:true,json:async()=>({markets:[{...market,status:'active'}]})};
   }
   if(url.includes('/trade-api/v2/events?')){
     return {ok:false,json:async()=>({})};
   }
   return mockFetch(url);
 };
 const result=await fetchCryptoSignals({fetcher,now,symbols:['BTC']});
 assert.equal(result[0].marketTicker,market.ticker);
 assert.equal(result[0].yesAsk,.68);
 assert.equal(result[0].noAsk,.33);
 assert.equal(result[0].signalIsForecast,false);
 assert.equal(result[0].manualReviewAvailable,true);
});
test('crypto direction can be DOWN while its matching NO contract remains available for manual review',async()=>{
 const decreasing=ohlc.map((x,i)=>({time:x[0],open:104-i,close:103-i}));
 const fetcher=async url=>{
  if(url.includes('/trade-api/v2/markets?'))
    return {ok:true,json:async()=>({markets:[{...market,status:'active'}]})};
  if(url.includes('/trade-api/v2/events?'))
    return {ok:false,json:async()=>({})};
  if(url.includes('coinbase.com'))
    return {ok:true,json:async()=>decreasing.map(x=>[x.time,1,1,x.open,x.close,1])};
  if(url.includes('kraken.com'))
    return {ok:true,json:async()=>({error:[],result:{XBTUSD:decreasing.map(x=>[x.time,String(x.open),'110','90',String(x.close),'100','2',1])}})};
  if(url.includes('bitstamp.net'))
    return {ok:true,json:async()=>({data:{ohlc:decreasing.map(x=>({timestamp:String(x.time),open:String(x.open),close:String(x.close)}))}})};
  if(url.includes('api.gemini.com'))return {ok:true,json:async()=>decreasing.map(x=>[x.time*1000,x.open,110,90,x.close,1])};
  if(url.includes('www.okx.com'))return {ok:true,json:async()=>({code:'0',data:decreasing.map(x=>[String(x.time*1000),String(x.open),'110','90',String(x.close),'1'])})};
  throw Error('Unknown provider');
 };
 const result=await fetchCryptoSignals({fetcher,now,symbols:['BTC']});
 assert.equal(result[0].direction,'DOWN');
 assert.equal(result[0].marketTicker,market.ticker);
 assert.equal(result[0].manualSide,'no');
});

test('all seven distinct price venues report their own research observations',async()=>{const r=await fetchCryptoSignals({fetcher:mockFetch,now,symbols:['BTC']});assert.deepEqual(r[0].spotFeeds.map(x=>x.source).sort(),['bitfinex','bitstamp','coinbase','gemini','kraken','kucoin','okx']);});

test('five opening quotes produce one settlement-window reference',()=>{const close='2026-10-26T14:15:00Z',source=['coinbase','kraken','bitstamp','gemini','okx'].map(x=>({source:x,last:103,candles:[{time:Date.parse('2026-10-26T14:00:00Z')/1000,open:100}]}));const r=calculateCryptoWindowReference(source,close);assert.equal(r.sourceCount,5);assert.equal(r.referencePrice,100)});

test('official Kalshi crypto floor strike replaces five-minute proxy as the trading target',async()=>{
 const official={...market,status:'active',floor_strike:100};
 const fetcher=async url=>{
   if(url.includes('/markets?'))return {ok:true,json:async()=>({markets:[official]})};
   return mockFetch(url);
 };
 const [signal]=await fetchCryptoSignals({fetcher,now,symbols:['BTC']});
 assert.equal(signal.reference?.referencePrice,100);
 assert.equal(signal.reference?.exactBenchmarkReference,true);
 assert.equal(signal.model?.trials,5000);
 assert.ok(signal.modeledWinProbability>.85);
});

test('failed independent price venues are recorded, not counted as agreeing votes',async()=>{const fetcher=async url=>{if(!url.includes('coinbase.com')&&!url.includes('kalshi.com'))throw Error('Venue network blocked');return mockFetch(url)};const [signal]=await fetchCryptoSignals({fetcher,now,symbols:['BTC']});assert.ok(signal.missingSources.some(x=>x.source==='gemini'&&x.reason==='PROVIDER_FAILURE'));assert.equal(signal.sources,1)});

test('Gemini minute-candle freshness uses its last observed minute, not the five-minute bucket start',async()=>{
 const now=Date.parse('2026-10-26T12:01:40Z');
 const start=Date.parse('2026-10-26T11:36:00Z');
 const candles=Array.from({length:24},(_,i)=>[start+i*60000,100+i*.05,101+i*.05,99+i*.05,100.04+i*.05,2]).reverse();
 const fetcher=async url=>{
  if(!url.includes('api.gemini.com'))throw Error('Other provider unavailable');
  return {ok:true,json:async()=>candles};
 };
 const rows=await spotMomentum(fetcher,'BTC',now);
 assert.ok(rows.some(x=>x.source==='gemini'));
});

test('ESPN summary odds alone do not establish a fresh live game play without matching score evidence',()=>{const event={id:'401873011',competitions:[{}]};const summary={header:{id:'401873011',competitions:[{status:{type:{state:'in'}}}]},winprobability:[{playId:'4018730113963',homeWinPercentage:.95,tiePercentage:0}]};const model=parseLiveWinProbability(summary,event);assert.equal(model.sourceVerified,false);assert.equal(model.homeProbability,null);assert.equal(parseLiveWinProbability({...summary,header:{...summary.header,competitions:[{status:{type:{state:'post'}}}]}},event).sourceVerified,false)});

test('a YES market does not require a simultaneous NO quote',async()=>{const fetcher=async url=>url.includes('/markets?')?{ok:true,json:async()=>({markets:[{...market,no_ask_dollars:null}]})}:mockFetch(url);const row=(await fetchCryptoSignals({fetcher,now,symbols:['BTC']}))[0];assert.equal(row.marketTicker,market.ticker)});

test('ESPN late-game win probability can match recent summary play without scoreboard situation',()=>{const at=Date.parse('2026-10-26T19:00:00Z');const event={id:'TEST',status:{period:4},competitions:[{competitors:[{homeAway:'home',score:'31'},{homeAway:'away',score:'10'}]}]};const summary={header:{id:'TEST'},winprobability:[{homeWinPercentage:.94,tiePercentage:0,playId:'P55'}],drives:{current:{plays:[{id:'P55',homeScore:31,awayScore:10,period:{number:4},wallclock:new Date(at-8000).toISOString()}]}}};assert.equal(parseLiveWinProbability(summary,event,at).sourceVerified,true);assert.equal(parseLiveWinProbability(summary,{...event,id:'other'},at).sourceVerified,false)});

test('ESPN summary play with old wallclock or mismatched scoreboard scores is not validated',()=>{const at=Date.parse('2026-10-26T19:00:00Z');const event={id:'TEST',status:{period:4},competitions:[{competitors:[{homeAway:'home',score:'31'},{homeAway:'away',score:'10'}]}]};const summary={header:{id:'TEST'},winprobability:[{homeWinPercentage:.97,tiePercentage:0,playId:'P55'}],plays:[{id:'P55',homeScore:30,awayScore:10,period:{number:4},wallclock:new Date(at-5000).toISOString()}]};assert.equal(parseLiveWinProbability(summary,event,at).sourceVerified,false);summary.plays[0].homeScore=31;assert.equal(parseLiveWinProbability(summary,event,at+180000).sourceVerified,false)});

test('ESPN game summary latest play can verify live late-game probability when situation is absent',()=>{
 const event={id:'GAME-2',status:{type:{state:'in'},period:4,clock:210},
   competitions:[{competitors:[
     {homeAway:'home',score:'31'},{homeAway:'away',score:'10'}]}]};
 const summary={header:{id:'GAME-2'},winprobability:[
   {homeWinPercentage:.93,playId:'p11'},{homeWinPercentage:.95,playId:'p12'}],
   drives:{current:{plays:[
    {id:'p11',period:{number:4},clock:{displayValue:'3:45'},homeScore:31,awayScore:10},
    {id:'p12',period:{number:4},clock:{displayValue:'3:32'},homeScore:31,awayScore:10,
     wallclock:new Date(now-1000).toISOString()}]}}};
 const got=parseLiveWinProbability(summary,event,now);
 assert.equal(got.sourceVerified,true);assert.equal(got.homeProbability,.95);
 assert.equal(got.modelPlayId,'p12');
});
test('ESPN summary model is rejected if scoreboard clock or period differs materially',()=>{
 const event={id:'GAME-2',status:{type:{state:'in'},period:4,clock:90},
  competitions:[{competitors:[{homeAway:'home',score:'31'},{homeAway:'away',score:'10'}]}]};
 const summary={header:{id:'GAME-2'},
  winprobability:[{homeWinPercentage:.95,playId:'p12'}],
  drives:{current:{plays:[{id:'p12',period:{number:4},
   clock:{displayValue:'3:32'},homeScore:31,awayScore:10,
   wallclock:new Date(now-1000).toISOString()}]}}};
 assert.equal(parseLiveWinProbability(summary,event,now).sourceVerified,false);
 assert.equal(parseLiveWinProbability(summary,{...event,status:{type:{state:'in'},period:3,clock:212}},now).sourceVerified,false);
});
