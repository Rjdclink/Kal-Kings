import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScoreboard,fetchSportsSignals,parseLiveWinProbability,selectSportsMarket,selectTotalsMarket,selectExceededTotalsMarkets} from './predictive_feeds.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');

test('live sports lead and totals context use the verified live scoreboard',()=>{
 const scoreboard={events:[{id:'1',name:'Dallas at Philadelphia',status:{type:{state:'in'},period:4,clock:240},competitions:[{
  competitors:[{homeAway:'home',score:'31',team:{id:'1',displayName:'Philadelphia Eagles'}},{homeAway:'away',score:'10',team:{id:'2',displayName:'Dallas Cowboys'}}],
  venue:{indoor:false,address:{city:'Philadelphia',state:'PA'}},odds:[{overUnder:43.5}]}]}]};
 const rows=normalizeScoreboard(scoreboard,'NFL',now);
 assert.equal(rows.length,1);assert.equal(rows[0].lateGame.direction,'Philadelphia Eagles');
 assert.equal(rows[0].totals.eligibleForAutomation,false);
});

test('sports contract matching accepts known Kalshi ticker aliases without weakening game identity',()=>{
 const markets=[{ticker:'KXNBAGAME-26OCT26NYGS-GS',status:'active'},
  {ticker:'KXNBAGAME-26OCT26NYBOS-BOS',status:'active'}];
 const event={sport:'NBA',date:'2026-10-26',homeAbbreviation:'GSW',awayAbbreviation:'NYK',selectedAbbreviation:'GSW'};
 assert.equal(selectSportsMarket(event,markets).ticker,markets[0].ticker);
 assert.equal(selectSportsMarket({...event,awayAbbreviation:'BOS'},markets),null);
});

test('only exact date, both teams, and selected outcome qualify a sports contract',()=>{
 const markets=[{ticker:'KXNFLGAME-26OCT26DALPHI-PHI',status:'active'},
  {ticker:'KXNFLGAME-26OCT26NYGPHI-PHI',status:'active'}];
 const event={sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',selectedAbbreviation:'PHI'};
 assert.equal(selectSportsMarket(event,markets).ticker,markets[0].ticker);
 assert.equal(selectSportsMarket({...event,awayAbbreviation:'SEA'},markets),null);
});

test('totals matching rejects another game and supports team ticker aliases',()=>{
 assert.equal(selectTotalsMarket({sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',totalLine:30},[]),null);
 const market={ticker:'KXNBATOTAL-26OCT26NYGS-230',status:'active',floorStrike:229.5,yesAsk:.91,rulesPrimary:'If New York and Golden State collectively score more than 229.5 points, resolves to Yes.'};
 const event={sport:'NBA',date:'2026-10-26',homeAbbreviation:'GSW',awayAbbreviation:'NYK',totalLine:230};
 assert.equal(selectTotalsMarket(event,[market]).ticker,market.ticker);
});

test('exact NFL total line selects the correct Kalshi market',()=>{
 const market={ticker:'KXNFLTOTAL-26OCT26DALPHI-30',status:'active',floorStrike:29.5,yesAsk:.91,rulesPrimary:'If Dallas and Philadelphia collectively score more than 29.5 points, resolves to Yes.'};
 const event={sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',totalLine:30};
 assert.equal(selectTotalsMarket(event,[market]).ticker,market.ticker);
});

test('live scoreboard attaches exact active Kalshi totals and the live score',async()=>{
 const event={id:'g1',date:'2026-10-26T19:00:00Z',name:'Dallas Cowboys at Philadelphia Eagles',
  status:{type:{state:'in'},period:4,clock:250},competitions:[{competitors:[
   {homeAway:'home',score:'31',team:{id:'home1',abbreviation:'PHI',displayName:'Philadelphia Eagles'}},
   {homeAway:'away',score:'20',team:{id:'away1',abbreviation:'DAL',displayName:'Dallas Cowboys'}}],
   venue:{indoor:true,address:{city:'Philadelphia'}},odds:[{overUnder:44.5}]}]};
 const total={ticker:'KXNFLTOTAL-26OCT26DALPHI-44',status:'active',floor_strike:44.5,yes_ask_dollars:'0.89',no_ask_dollars:'0.12',yes_ask_size_fp:'10.00',close_time:new Date(now+300000).toISOString(),rules_primary:'If Dallas and Philadelphia collectively score more than 44.5 points, then market resolves to Yes.'};
 const fetcher=async url=>{let payload;
  if(url.endsWith('/scoreboard'))payload={events:[event]};
  else if(url.endsWith('/injuries'))payload={injuries:[]};
  else if(url.includes('KXNFLTOTAL'))payload={markets:[total]};
  else payload={markets:[]};
  return {ok:true,json:async()=>payload};
 };
 const result=await fetchSportsSignals({fetcher,now,sports:['NFL']});
 assert.equal(result.length,1);assert.equal(result[0].totalMarket?.ticker,total.ticker);
 assert.equal(result[0].totalGame?.homeScore,31);assert.equal(result[0].marketMatchVerified,false);
});

test('already-exceeded total scan returns every matching crossed threshold',()=>{
 const game={sport:'NFL',date:'2026-10-26',homeAbbreviation:'PHI',awayAbbreviation:'DAL',homeScore:31,awayScore:20};
 const markets=[44.5,49.5,50.5,53.5].map((line,i)=>({ticker:'KXNFLTOTAL-26OCT26DALPHI-'+i,status:'active',floorStrike:line,yesAsk:.93+i*.01,yesDepth:8,closeTime:new Date(now+180000).toISOString(),rulesPrimary:'If Dallas and Philadelphia collectively score more than '+line+' points in the game, then market resolves to Yes.'}));
 const out=selectExceededTotalsMarkets(game,markets,{now});
 assert.equal(out.length,3);assert.ok(out.every(x=>x.floorStrike<51));
 assert.equal(selectExceededTotalsMarkets({...game,awayAbbreviation:'NYG'},markets,{now}).length,0);
});

test('external live win probability requires the exact ESPN event and latest play',()=>{
 const event={id:'GAME-1',date:'2026-10-26T23:00:00Z',competitions:[{situation:{lastPlay:{id:'PLAY-55'}}}]};
 const summary={header:{id:'GAME-1'},winprobability:[{homeWinPercentage:.94,tiePercentage:0,playId:'PLAY-55'}]};
 assert.equal(parseLiveWinProbability(summary,event).sourceVerified,true);
 assert.equal(parseLiveWinProbability(summary,{...event,id:'WRONG'}).sourceVerified,false);
 assert.equal(parseLiveWinProbability(summary,{...event,competitions:[{situation:{lastPlay:{id:'PLAY-56'}}}]}).sourceVerified,false);
});

test('ESPN summary model is rejected when its event is not the same active game',()=>{
 const event={id:'401873011',competitions:[{}]};
 const summary={header:{id:'401873011',competitions:[{status:{type:{state:'in'}}}]},winprobability:[{playId:'4018730113963',homeWinPercentage:.95,tiePercentage:0}]};
 assert.equal(parseLiveWinProbability(summary,event).sourceVerified,false);
 assert.equal(parseLiveWinProbability({...summary,header:{...summary.header,id:'other'}},event).sourceVerified,false);
});
