/** Kal Kings independent live signal-feed adapters. Read-only; never place orders. */
import {assessLateGame,assessTotals} from './predictive_strategies.mjs';
import {matchSportsOutcome,assessTotalsProjection} from './strategy_optimizer.mjs';
const KALSHI='https://api.elections.kalshi.com/trade-api/v2';
const ESPN='https://site.api.espn.com/apis/site/v2/sports';
const SPORTS_MARKET_SERIES={NFL:'KXNFLGAME',NBA:'KXNBAGAME',NHL:'KXNHLGAME',MLB:'KXMLBGAME',CFB:'KXCFBGAME',CBB:['KXCBBGAME','KXNCAAMBGAME'],WNBA:'KXWNBAGAME',EPL:'KXEPLGAME',MLS:'KXMLSGAME'};
const SPORTS_TOTAL_SERIES={NFL:'KXNFLTOTAL',NBA:'KXNBATOTAL',NHL:'KXNHLTOTAL',MLB:'KXMLBTOTAL',CFB:'KXCFBTOTAL',CBB:['KXCBBTOTAL','KXNCAAMBTOTAL'],WNBA:'KXWNBATOTAL',EPL:'KXEPLTOTAL',MLS:'KXMLSTOTAL'};
const integer=n=>Number.isFinite(Number(n))?Number(n):null;
const timeout=()=>typeof AbortSignal==='undefined'?undefined:AbortSignal.timeout(7000);
async function json(fetcher,url){
 const r=await fetcher(url,{method:'GET',signal:timeout(),redirect:'error'});
 if(!r?.ok)throw Error('HTTP_'+Number(r?.status||0));
 return r.json();
}
function matchesSportsTicker(sport,series,dateCode,away,home,ticker){
 const t=String(ticker||'').toUpperCase(),aways=feedTeamAliases(sport,away),homes=feedTeamAliases(sport,home);
 for(const a of aways)for(const h of homes){
  if(sport==='MLB'){if(new RegExp('^'+series+'-'+dateCode+'\\\\d{4}(?:'+a+h+'|'+h+a+')-').test(t))return true;}
  else if(t.startsWith(series+'-'+dateCode+a+h+'-')||t.startsWith(series+'-'+dateCode+h+a+'-'))return true;
 }
 return false;
}
const FEED_TEAM_TICKER_ALIASES={NBA:{BKN:['BRK'],NYK:['NY'],GSW:['GS'],NOP:['NO'],SAS:['SA'],UTA:['UTAH'],PHX:['PHO']},NHL:{LAK:['LA'],SJS:['SJ'],TBL:['TB'],NJD:['NJ'],VGK:['VEG']},MLB:{CWS:['CHW'],KCR:['KC'],SDP:['SD'],SFG:['SF'],TBR:['TB'],WSN:['WSH'],ATH:['OAK']},NFL:{WSH:['WAS'],JAC:['JAX'],LAR:['LA'],LAC:['SD'],LV:['OAK']},CFB:{},CBB:{},WNBA:{},EPL:{},MLS:{}};
const feedTeamAliases=(sport,team)=>[...new Set([String(team||'').toUpperCase(),...(FEED_TEAM_TICKER_ALIASES[sport]?.[String(team||'').toUpperCase()]||[])])];
const safe=val=>{if(val===null||val===undefined||val==='')return null;const n=Number(val);return Number.isFinite(n)?n:null;};
// Kalshi's legacy quote fields are integer cents; *_dollars fields are dollars.
const kalshiPrice=(dollars,cents)=>{
 if(dollars!==null&&dollars!==undefined&&dollars!==''){
  const n=Number(dollars);return Number.isFinite(n)&&n>=0&&n<=1?n:null;
 }
 if(cents!==null&&cents!==undefined&&cents!==''){
  const n=Number(cents);return Number.isFinite(n)&&n>=0&&n<=100?n/100:null;
 }
 return null;
};
const kalshiDepth=(fp,legacy)=>{
 const v=fp!==null&&fp!==undefined&&fp!==''?fp:legacy;
 if(v===null||v===undefined||v==='')return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;
};
function parseClockSeconds(value,sport,period){
 if(typeof value==='number'&&Number.isFinite(value))return value;
 const raw=String(value??'').trim();
 const match=raw.match(/^(\d+):(\d{2})(?:\.\d+)?$/);
 if(match){
   const seconds=Number(match[1])*60+Number(match[2]);
   return ['EPL','MLS'].includes(sport)&&Number(period)===2?Math.max(0,5400-seconds):seconds;
 }
 const n=Number(raw);
 return Number.isFinite(n)?n:NaN;
}
function easternDate(when){
 const d=new Date(when);
 if(!Number.isFinite(d.valueOf()))return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
   year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 const get=x=>parts.find(p=>p.type===x)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
export function parseLiveWinProbability(summary,event,now=Date.now()){
 const unavailable={homeProbability:null,awayProbability:null,sourceVerified:false,reason:'ESPN_PLAY_NOT_VERIFIED'};
 const item=Array.isArray(summary?.winprobability)?summary.winprobability.at(-1):null;
 const home=safe(item?.homeWinPercentage),tie=safe(item?.tiePercentage??0);
 const competition=event?.competitions?.[0];
 const lastScorePlay=String(competition?.situation?.lastPlay?.id||'');
 const modelPlay=String(item?.playId||'');
 const summaryState=summary?.header?.competitions?.[0]?.status?.type?.state;
 if(!event?.id||String(summary?.header?.id)!==String(event.id)||
   !modelPlay||(lastScorePlay&&lastScorePlay!==modelPlay)||
   (summaryState&&summaryState!=='in')||
   (event.status?.type?.state&&event.status.type.state!=='in')||
   home===null||home<0||home>1||tie===null||tie<0||tie>1||
   home+tie>1.001)return unavailable;
 if(!lastScorePlay){
   // Scoreboard situation.lastPlay is frequently omitted by ESPN.
   // Only substitute a summary play if its game, period, BOTH scores and
   // recorded wallclock match the fresh live scoreboard.
   const plays=[...(summary?.drives?.current?.plays||[]),
     ...(summary?.drives?.previous?.at(-1)?.plays||[]),
     ...(summary?.plays||[])];
   const play=plays.find(x=>String(x?.id||'')===modelPlay);
   const homeTeam=competition?.competitors?.find(x=>x.homeAway==='home');
   const awayTeam=competition?.competitors?.find(x=>x.homeAway==='away');
   const scoreboardPeriod=Number(event?.status?.period??competition?.status?.period);
   const lastPeriod=Number(play?.period?.number);
   const observed=now-Date.parse(play?.wallclock||'');
   const scoreClock=event?.status?.clock??competition?.status?.clock;
   const playClockMatch=/^(\d{1,2}):(\d{2})$/.exec(String(play?.clock?.displayValue||''));
   const lastClock=playClockMatch?60*Number(playClockMatch[1])+Number(playClockMatch[2]):null;
   // Scores can be unchanged for several minutes while the model becomes stale.
   // Require play clock agreement when both clocks are supplied.
   if(scoreClock!=null&&lastClock!=null&&Number.isFinite(Number(scoreClock))&&
      Math.abs(Number(scoreClock)-lastClock)>30)return unavailable;
   if(!play||!Number.isFinite(observed)||observed<0||observed>90000||
     !Number.isFinite(scoreboardPeriod)||!Number.isFinite(lastPeriod)||
     scoreboardPeriod!==lastPeriod||
     !homeTeam||!awayTeam||Number(homeTeam.score)!==Number(play.homeScore)||
     Number(awayTeam.score)!==Number(play.awayScore))
       return unavailable;
 }
 return {homeProbability:home,awayProbability:Math.max(0,1-home-tie),
   sourceVerified:true,source:'ESPN_LIVE_MODEL',modelPlayId:modelPlay,
   reason:lastScorePlay?'MATCHED_SCOREBOARD_PLAY':'MATCHED_FRESH_SUMMARY_PLAY'};
}
export function selectSportsMarket(event,markets){
 for(const market of Array.isArray(markets)?markets:[]){
   if(!['open','active'].includes(market.status))continue;
   if(matchSportsOutcome(event,market).matched)return market;
 }
 return null;
}
export function selectTotalsMarket(game,markets){
 const prefix=SPORTS_TOTAL_SERIES[game?.sport],date=game?.date;
 if(!prefix||typeof date!=='string'||!Number.isFinite(Date.parse(date+'T12:00:00Z')))return null;
 const [y,m,d]=date.split('-'),code=d+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(m)-1]+y.slice(-2);
 const a=String(game?.awayAbbreviation||'').toUpperCase(),h=String(game?.homeAbbreviation||'').toUpperCase();
 if(!a||!h||a===h||!Number.isFinite(Number(game?.totalLine)))return null;
 const prefixes=Array.isArray(prefix)?prefix:[prefix];
 const matches=(Array.isArray(markets)?markets:[]).filter(q=>
  prefixes.some(series=>matchesSportsTicker(game.sport,series,code,a,h,q.ticker))&&
  ['active','open'].includes(q.status)&&q.floorStrike!=null&&
  Number.isFinite(Number(q.floorStrike))&&q.yesAsk>0&&q.yesAsk<1&&
  /(collectively score more than|score more goals than|score more runs than|combined score.*more than)/i.test(q.rulesPrimary||''))
  .map(q=>({q,delta:Math.abs(Number(q.floorStrike)+.5-Number(game.totalLine))}))
  .sort((x,y)=>x.delta-y.delta);
 return matches[0]&&matches[0].delta<=3?matches[0].q:null;
}

/** Examine every executable score-crossed total, not only the line shown
 * by an unrelated sportsbook. Each is reverified against the actual
 * exchange order book before any order can be submitted.
 */
export function selectExceededTotalsMarkets(game,markets,{now=Date.now(),max=24}={}){
 const series=SPORTS_TOTAL_SERIES[game?.sport];
 const date=game?.date,score=Number(game?.homeScore)+Number(game?.awayScore);
 if(!series||typeof date!=='string'||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||
    !Number.isFinite(score)||score<=0)return [];
 const [year,month,day]=date.split('-');
 const short=day+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(month)-1]+year.slice(-2);
 const home=String(game?.homeAbbreviation||'').toUpperCase(),
   away=String(game?.awayAbbreviation||'').toUpperCase();
 if(!/^[A-Z]{2,4}$/.test(home)||!/^[A-Z]{2,4}$/.test(away)||home===away)return [];
 return (Array.isArray(markets)?markets:[]).filter(x=>{
   const strike=Number(x?.floorStrike),ask=Number(x?.yesAsk),depth=Number(x?.yesDepth);
   return (Array.isArray(series)?series:[series]).some(type=>matchesSportsTicker(game.sport,type,short,away,home,x.ticker))&&
     ['active','open'].includes(x.status)&&
     Number.isFinite(strike)&&strike>0&&score>strike&&
     Number.isFinite(ask)&&ask>0&&ask<1&&
     Number.isFinite(depth)&&depth>=1&&
     Date.parse(x.closeTime||'')>now+10000&&
     /(collectively score more than|score more goals than|score more runs than|combined score.*more than)/i.test(String(x.rulesPrimary||''))&&
     String(x.rulesPrimary||'').includes(String(strike))&&
     /resolves? to Yes/i.test(String(x.rulesPrimary||''));
 }).sort((a,b)=>
   (a.yesAsk-b.yesAsk)||(Date.parse(a.closeTime)-Date.parse(b.closeTime)))
 .slice(0,max);
}

async function fetchSportsMarkets(fetcher,sport,now,kind='game'){
 const configured=(kind==='total'?SPORTS_TOTAL_SERIES:SPORTS_MARKET_SERIES)[sport];
 const seriesList=(Array.isArray(configured)?configured:[configured]).filter(Boolean);
 if(!seriesList.length)return [];
 const normalize=markets=>(Array.isArray(markets)?markets:[]).map(m=>({
   ticker:m.ticker,status:m.status,eventTicker:m.event_ticker,
   yesAsk:kalshiPrice(m.yes_ask_dollars,m.yes_ask),noAsk:kalshiPrice(m.no_ask_dollars,m.no_ask),
   yesBid:kalshiPrice(m.yes_bid_dollars,m.yes_bid),noBid:kalshiPrice(m.no_bid_dollars,m.no_bid),
   yesDepth:kalshiDepth(m.yes_ask_size_fp,m.yes_ask_size),
   noDepth:kalshiDepth(m.no_ask_size_fp,m.no_ask_size),
   rulesPrimary:m.rules_primary||'',floorStrike:safe(m.floor_strike),closeTime:m.close_time,
   observedAt:new Date(now).toISOString(),eventTitle:m.event_ticker||'',
   marketTitle:m.title||m.subtitle||'',source:'Kalshi'
 }));
 const batches=await Promise.allSettled(seriesList.map(async series=>{
   let all=[],cursor=null;
   for(let page=0;page<5;page++){
     let url=KALSHI+'/markets?series_ticker='+encodeURIComponent(series)+'&status=open&limit=1000';
     if(cursor)url+='&cursor='+encodeURIComponent(cursor);
     const j=await json(fetcher,url);
     all.push(...(j.markets||[]));cursor=j.cursor||null;
     if(!cursor)break;
   }
   if(!all.length){
     try{
       const events=await json(fetcher,KALSHI+'/events?series_ticker='+
         encodeURIComponent(series)+'&status=open&limit=200&with_nested_markets=true');
       all=(events.events||[]).flatMap(e=>Array.isArray(e.markets)?e.markets:[]);
     }catch{/* No fallback data means no verified candidate. */}
   }
   return normalize(all);
 }));
 const unique=new Map();
 for(const batch of batches)if(batch.status==='fulfilled')
   for(const market of batch.value)if(market.ticker&&!unique.has(market.ticker))
     unique.set(market.ticker,market);
 return [...unique.values()];
}
export function normalizeScoreboard(data,sport,now=Date.now(),enrichment={}){
 const out=[];
 for(const event of data?.events||[]){
   const contest=event.competitions?.[0],home=contest?.competitors?.find(x=>x.homeAway==='home'),
     away=contest?.competitors?.find(x=>x.homeAway==='away');
   if(!home||!away)continue;
   const period=Number(event.status?.period??contest?.status?.period);
   const clockRaw=event.status?.clock??contest?.status?.clock;
   const clockParsed=parseClockSeconds(clockRaw,sport,period);
   const clock=sport==='MLB'&&!Number.isFinite(clockParsed)?0:clockParsed;
   const state=String(event.status?.type?.state||contest?.status?.type?.state||'pre');
   const city=contest?.venue?.address?.city||null;
   const weather=enrichment.weatherByCity?.[city]||{indoor:contest?.venue?.indoor===true};
   const injuries=[...(enrichment.injuriesByTeam?.[home.team?.id]||[]),
     ...(enrichment.injuriesByTeam?.[away.team?.id]||[])];
   const game={sport,home:home.team?.displayName||home.team?.name,away:away.team?.displayName||away.team?.name,
     homeScore:Number(home.score),awayScore:Number(away.score),period,clockSeconds:clock,
     state,updatedAt:new Date(now).toISOString()};
   const lateGame=assessLateGame({...game,now});
   const totalLine=Number(contest.odds?.find(x=>Number.isFinite(Number(x.overUnder)))?.overUnder);
   const totals=assessTotals({...game,totalLine:totalLine||null,weather,injuries,now});
   if(state==='in'||lateGame.direction||totals.direction)out.push({id:event.id,event:event.name||'',
     sport,score:`${away.score}-${home.score}`,period,clockSeconds:clock,
     lateGame,totals,windMph:weather.windMph??null,gustMph:weather.gustMph??null,
     injuryCount:injuries.length,verifiedWeather:Boolean(enrichment.weatherByCity?.[city]),
     weather,injuries,gameContext:game,
     marketMatchVerified:false,eligibleForAutomation:false,
     updatedAt:new Date(now).toISOString()});
 }
 return out;
}
async function openMeteoWind(fetcher,city,indoor){
 if(indoor)return {indoor:true};
 if(!city)return {indoor:false};
 try{
  const p=await json(fetcher,`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&countryCode=US`);
  const loc=p.results?.[0];if(!loc)return {indoor:false};
  const wx=await json(fetcher,`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=wind_speed_10m,wind_gusts_10m,precipitation&wind_speed_unit=mph&timezone=UTC`);
  return {indoor:false,windMph:integer(wx.current?.wind_speed_10m),gustMph:integer(wx.current?.wind_gusts_10m),
    precipitationMm:integer(wx.current?.precipitation),source:'Open-Meteo'};
 }catch{return {indoor:false};}
}
export async function fetchSportsSignals({fetcher=fetch,now=Date.now(),sports=['NFL','NBA','NHL','MLB','CFB','CBB','EPL','MLS','WNBA']}={}){
 const route={NFL:'football/nfl',NBA:'basketball/nba',NHL:'hockey/nhl',MLB:'baseball/mlb',CFB:'football/college-football',CBB:'basketball/mens-college-basketball',EPL:'soccer/eng.1',MLS:'soccer/usa.1',WNBA:'basketball/wnba'};
 const outputs=await Promise.all(sports.filter(x=>route[x]).map(async sport=>{
  try{
   const j=await json(fetcher,`${ESPN}/${route[sport]}/scoreboard`);
   const live=(j.events||[]).filter(x=>x.status?.type?.state==='in');
   if(!live.length)return [];
   let injuryMap={},weatherMap={};
   if(sport==='NFL'||sport==='NBA'){
    try{
     const injuryData=await json(fetcher,`${ESPN}/${route[sport]}/injuries`);
     for(const club of injuryData.injuries||[]){
       injuryMap[club.id]=(club.injuries||[]).filter(x=>/^(out|inactive)$/i.test(x.status||'')).map(x=>({
        team:club.id,role:x.athlete?.position?.abbreviation||'UNKNOWN',status:x.status,
        athlete:x.athlete?.displayName||'Unknown',source:'ESPN Injuries'}));
     }
    }catch{/* Injuries unavailable is NOT interpreted as confirmed healthy. */}
   }
   if(sport==='NFL'){
    const cities=[...new Map(live.map(x=>[x.competitions?.[0]?.venue?.address?.city,x.competitions?.[0]?.venue])
       .filter(x=>x[0])).values()];
    const result=await Promise.allSettled(cities.map(async venue=>({
       city:venue.address.city,weather:await openMeteoWind(fetcher,venue.address.city,venue.indoor)
    })));
    for(const x of result)if(x.status==='fulfilled')weatherMap[x.value.city]=x.value.weather;
   }
   const observations=normalizeScoreboard({...j,events:live},sport,now,{weatherByCity:weatherMap,injuriesByTeam:injuryMap});
   const [markets,totalMarkets]=await Promise.all([fetchSportsMarkets(fetcher,sport,now),fetchSportsMarkets(fetcher,sport,now,'total')]);
   return await Promise.all(observations.map(async signal=>{
     const event=live.find(x=>x.id===signal.id),contest=event?.competitions?.[0];
     const home=contest?.competitors?.find(x=>x.homeAway==='home'),
       away=contest?.competitors?.find(x=>x.homeAway==='away');
     let probability={sourceVerified:false,homeProbability:null,awayProbability:null};
     if(signal.lateGame?.direction&&event){
       try{
         const summary=await json(fetcher,`${ESPN}/${route[sport]}/summary?event=${encodeURIComponent(event.id)}`);
         probability=parseLiveWinProbability(summary,event,now);
       }catch{/* A missing play-verified ESPN estimate is not authorization. */}
     }
     const leader=signal.lateGame?.direction,
       selected=leader===home?.team?.displayName?home?.team?.abbreviation:
         leader===away?.team?.displayName?away?.team?.abbreviation:null;
     const game={sport,date:easternDate(event?.date),
       homeAbbreviation:home?.team?.abbreviation,awayAbbreviation:away?.team?.abbreviation,
       selectedAbbreviation:selected};
     const market=selected?selectSportsMarket(game,markets):null;
     const prediction=selected===home?.team?.abbreviation?probability.homeProbability:
       selected===away?.team?.abbreviation?probability.awayProbability:null;
     const oddsLine=Number(contest?.odds?.find(x=>Number.isFinite(Number(x.overUnder)))?.overUnder);
     const totalsMarket=selectTotalsMarket({...game,totalLine:oddsLine},totalMarkets);
     const totalProjection=assessTotalsProjection({...signal.gameContext,
       totalLine:totalsMarket?.floorStrike??oddsLine,
       weather:signal.weather,injuries:signal.injuries,now});
     // The verified ESPN live scoreboard is the entry signal; do not
     // accidentally gate execution on an optional play-level win-probability
     // feed. A late lead is queued only when the correct active Kalshi outcome
     // is independently matched. The runner still rechecks price, depth, fees,
     // exposure, bankroll, and the exchange's actual order response.
     const scoreVerified=Boolean(event?.id&&signal.gameContext&&
       signal.gameContext.state==='in'&&signal.gameContext.updatedAt&&
       Number.isFinite(Date.parse(signal.gameContext.updatedAt)));
     const lateGameReady=Boolean(scoreVerified&&signal.lateGame?.eligibleForAutomation&&market);
     const lateGame={...signal.lateGame,
       eligibleForAutomation:lateGameReady,
       action:lateGameReady?'EXECUTION_CANDIDATE':'REVIEW_ONLY',
       reason:signal.lateGame?.eligibleForAutomation?
         (market?'COMMANDING_LATE_LEAD':'NO_MATCHING_ACTIVE_KALSHI_CONTRACT'):
         signal.lateGame?.reason};
     return {...signal,lateGame,externalWinProbability:prediction,
       sourceVerified:scoreVerified,
       marketMatchVerified:Boolean(market),market:market||null,
       independentModelSource:probability.sourceVerified?'ESPN_LIVE_MODEL':null,
       modelPlayId:probability.modelPlayId||null,
       totalProjection,totalMarket:totalsMarket||null,
       exceededTotalsMarkets:selectExceededTotalsMarkets({
         ...game,homeScore:Number(home?.score),awayScore:Number(away?.score)
       },totalMarkets,{now}),
       totalGame:{...signal.gameContext,date:game.date,
         homeAbbreviation:game.homeAbbreviation,awayAbbreviation:game.awayAbbreviation},
       kalshiMarketSource:market?'Kalshi public events':'NONE',
       eventKey:game.date?game.sport+':'+game.date+':'+game.awayAbbreviation+':'+game.homeAbbreviation:null};
   }));
  }catch{return []}
 }));
 return outputs.flat().slice(0,30);
}
