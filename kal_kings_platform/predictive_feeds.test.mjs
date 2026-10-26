import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCryptoSignals,normalizeScoreboard,fetchSportsSignals} from './predictive_feeds.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const epoch=Math.floor(now/1000);
const ohlc=[
 [epoch-900,1,1,100,101,1],
 [epoch-600,1,1,101,102,1],
 [epoch-300,1,1,102,103,1],
 [epoch-10,1,1,103,104,1]
];
const market={ticker:'KXBTC15M-26OCT261210-10',status:'open',yes_ask_dollars:'0.6800',no_ask_dollars:'0.3300',yes_ask_size_fp:'12.00',no_ask_size_fp:'8.00',close_time:new Date(now+10*60000).toISOString(),rules_primary:"The sixty seconds CF Benchmarks BRTI average before expiry compared to the average at least as high before the window started."};
const mockFetch=async url=>{
 let value;
 if(url.includes('coinbase.com'))value=ohlc;
 else if(url.includes('kraken.com'))value={error:[],result:{XXBTZUSD:ohlc.map(v=>[v[0],String(v[3]),'110','90',String(v[4]),'100','2',1])}};
 else if(url.includes('bitstamp.net'))value={data:{ohlc:ohlc.map(v=>({timestamp:String(v[0]),open:String(v[3]),close:String(v[4])}))}};
 else if(url.includes('kalshi.com'))value={events:[{event_ticker:'KXBTC15M-26OCT261210',markets:[market]}]};
 else throw Error('Unexpected URL: '+url);
 return {ok:true,json:async()=>value};
};
test('crypto spot and directional Kalshi market are collected without claiming an order',async()=>{
 const r=await fetchCryptoSignals({fetcher:mockFetch,now,symbols:['BTC']});
 assert.equal(r.length,1);assert.equal(r[0].direction,'UP');
 assert.equal(r[0].sources,3);assert.equal(r[0].marketTicker,market.ticker);
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

import {selectTotalsMarket} from './predictive_feeds.mjs';
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
