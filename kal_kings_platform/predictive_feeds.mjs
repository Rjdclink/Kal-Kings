/** Kal Kings independent live signal-feed adapters. Read-only; never place orders. */
import {cryptoConsensus,planDirectionalTrade,assessLateGame,assessTotals} from './predictive_strategies.mjs';
import {technicalIndicators,assessCryptoRegime,matchSportsOutcome,assessTotalsProjection} from './strategy_optimizer.mjs';
const KALSHI='https://external-api.kalshi.com/trade-api/v2';
const ESPN='https://site.api.espn.com/apis/site/v2/sports';
const integer=n=>Number.isFinite(Number(n))?Number(n):null;
const timeout=()=>typeof AbortSignal==='undefined'?undefined:AbortSignal.timeout(7000);
async function json(fetcher,url){
 const r=await fetcher(url,{method:'GET',signal:timeout(),redirect:'error'});
 if(!r?.ok)throw Error('Data provider unavailable');
 return r.json();
}
const candidates={
 BTC:{coinbase:'BTC-USD',kraken:'XBTUSD',bitstamp:'btcusd'},
 ETH:{coinbase:'ETH-USD',kraken:'ETHUSD',bitstamp:'ethusd'},
 SOL:{coinbase:'SOL-USD',kraken:'SOLUSD',bitstamp:'solusd'},
 XRP:{coinbase:'XRP-USD',kraken:'XRPUSD',bitstamp:'xrpusd'},
 DOGE:{coinbase:'DOGE-USD',kraken:'DOGEUSD',bitstamp:'dogeusd'},
 ADA:{coinbase:'ADA-USD',kraken:'ADAUSD',bitstamp:'adausd'}
};
function momentum(rows,{symbol,source,now}){
 const sorted=(Array.isArray(rows)?rows:[]).map(r=>({time:integer(r.time),
  open:integer(r.open),close:integer(r.close),high:integer(r.high),low:integer(r.low),volume:integer(r.volume)}))
  .filter(r=>r.time!==null&&r.open>0&&r.close>0&&r.time<=Math.floor(now/1000)+120)
  .sort((a,b)=>a.time-b.time);
 const latest=sorted.at(-1),first=sorted.at(-4);
 if(!latest||!first||now-latest.time*1000>360000||
   latest.time-first.time<600||latest.time-first.time>1500)return null;
 return {symbol,source,start:first.open,last:latest.close,indicators:technicalIndicators(sorted),observedAt:new Date(now).toISOString(),
   oldestCandleAt:new Date(first.time*1000).toISOString(),newestCandleAt:new Date(latest.time*1000).toISOString()};
}
export async function spotMomentum(fetcher,symbol,now){
 const pair=candidates[symbol];if(!pair)return [];
 const names=['coinbase','kraken','bitstamp'];
 const providers=names.map(async source=>{
  let j,rows;
  if(source==='coinbase'){
   j=await json(fetcher,`https://api.exchange.coinbase.com/products/${pair.coinbase}/candles?granularity=300`);
   rows=Array.isArray(j)?j.map(x=>({time:x[0],open:x[3],high:x[2],low:x[1],close:x[4],volume:x[5]})):[];
  }else if(source==='kraken'){
   j=await json(fetcher,`https://api.kraken.com/0/public/OHLC?pair=${pair.kraken}&interval=5`);
   if(j.error?.length)throw Error('Kraken data error');
   const array=Object.values(j.result||{}).find(Array.isArray)||[];
   rows=array.map(x=>({time:x[0],open:x[1],high:x[2],low:x[3],close:x[4],volume:x[6]}));
  }else{
   j=await json(fetcher,`https://www.bitstamp.net/api/v2/ohlc/${pair.bitstamp}/?step=300&limit=75`);
   rows=(j.data?.ohlc||[]).map(x=>({time:x.timestamp,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume}));
  }
  return momentum(rows,{symbol,source,now});
 });
 const settled=await Promise.allSettled(providers);
 return settled.filter(x=>x.status==='fulfilled'&&x.value).map(x=>x.value);
}

const SPORTS_MARKET_SERIES={NFL:'KXNFLGAME',NBA:'KXNBAGAME',NHL:'KXNHLGAME'};
const safe=val=>{const n=Number(val);return Number.isFinite(n)?n:null;};
function easternDate(when){
 const d=new Date(when);
 if(!Number.isFinite(d.valueOf()))return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
   year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 const get=x=>parts.find(p=>p.type===x)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
export function parseLiveWinProbability(summary,event){
 const no={homeProbability:null,awayProbability:null,sourceVerified:false,reason:'ESPN_PLAY_NOT_VERIFIED'};
 const item=Array.isArray(summary?.winprobability)?summary.winprobability.at(-1):null;
 const home=safe(item?.homeWinPercentage),tie=safe(item?.tiePercentage??0);
 const scorePlay=String(event?.competitions?.[0]?.situation?.lastPlay?.id||''),
    modelPlay=String(item?.playId||'');
 if(!event?.id||String(summary?.header?.id)!==String(event.id)||!scorePlay||
   scorePlay!==modelPlay||home===null||home<0||home>1||
   tie===null||tie<0||tie>1||home+tie>1.001)return no;
 return {homeProbability:home,awayProbability:Math.max(0,1-home-tie),
    sourceVerified:true,source:'ESPN_LIVE_MODEL',modelPlayId:modelPlay,
    reason:'MATCHED_CURRENT_ESPN_PLAY'};
}
export function selectSportsMarket(event,markets){
 for(const market of Array.isArray(markets)?markets:[]){
   if(!['open','active'].includes(market.status))continue;
   if(matchSportsOutcome(event,market).matched)return market;
 }
 return null;
}
async function fetchSportsMarkets(fetcher,sport,now){
 const series=SPORTS_MARKET_SERIES[sport];if(!series)return [];
 try{
   const j=await json(fetcher,`${KALSHI}/events?series_ticker=${series}&status=open&limit=200&with_nested_markets=true`);
   return (j.events||[]).flatMap(e=>(e.markets||[]).map(m=>({
     ticker:m.ticker,status:m.status,eventTicker:e.event_ticker,
     yesAsk:safe(m.yes_ask_dollars),noAsk:safe(m.no_ask_dollars),
     yesBid:safe(m.yes_bid_dollars),noBid:safe(m.no_bid_dollars),
     yesDepth:safe(m.yes_ask_size_fp),noDepth:safe(m.no_ask_size_fp),
     rulesPrimary:m.rules_primary||'',closeTime:m.close_time,
     observedAt:new Date(now).toISOString(),eventTitle:e.title||'',marketTitle:m.title||'',
     source:'Kalshi'})));
 }catch{return []}
}

export async function fetchCryptoSignals({fetcher=fetch,now=Date.now(),symbols=['BTC','ETH','SOL','XRP','DOGE','ADA']}={}){
 const all=await Promise.all(symbols.filter(x=>candidates[x]).map(async symbol=>{
   const [s,m]=await Promise.allSettled([
    spotMomentum(fetcher,symbol,now),
    json(fetcher,`${KALSHI}/events?series_ticker=KX${symbol}15M&status=open&limit=10&with_nested_markets=true`)
   ]);
   const spot=s.status==='fulfilled'?s.value:[],consensus=cryptoConsensus(spot,{symbol,now});
   const technical=spot.find(x=>x.source==='coinbase'&&x.indicators?.status==='OK')?.indicators||spot.find(x=>x.indicators?.status==='OK')?.indicators||null;
   const regime=assessCryptoRegime(consensus,technical);
   const markets=m.status==='fulfilled'?(m.value.events||[]).flatMap(e=>(e.markets||[]).map(k=>({
    ticker:k.ticker,seriesTicker:`KX${symbol}15M`,symbol,status:k.status,
    rulesPrimary:k.rules_primary||'',closeTime:k.close_time,
    yesAsk:integer(k.yes_ask_dollars),noAsk:integer(k.no_ask_dollars),
    yesDepth:integer(k.yes_ask_size_fp??k.yes_ask_size),
    noDepth:integer(k.no_ask_size_fp??k.no_ask_size),
    observedAt:new Date(now).toISOString()
   }))):[];
   const available=markets.filter(x=>['open','active'].includes(x.status)&&Date.parse(x.closeTime)-now>90000)
     .sort((a,b)=>Date.parse(a.closeTime)-Date.parse(b.closeTime));
   const market=available[0]||null;
   // Reporting a direction is NOT permission to submit an order: the independent,
   // settlement-calibrated probabilistic model is not yet connected.
   const decision=planDirectionalTrade({consensus,market,bankroll:0,feePerContract:NaN,model:null,now});
   return {symbol,direction:regime.direction==='UNKNOWN'?consensus.direction:regime.direction,sources:consensus.sources,
    technical,regime:regime.regime,signalStrength:regime.signalStrength,forecastCalibrated:false,
    agreeingSources:consensus.agreeingSources,agreement:consensus.agreement,
    spreadPct:consensus.spreadPct??null,spotPrice:consensus.medianPrice??null,
    spotFeeds:consensus.observations.map(x=>({source:x.source,returnPct:x.returnPct})),
    marketTicker:market?.ticker||null,yesAsk:market?.yesAsk??null,noAsk:market?.noAsk??null,
    closeTime:market?.closeTime||null,allowed:false,reason:decision.reason,
    status:!market?'NO_OPEN_MATCHING_KALSHI_MARKET':consensus.reason,
    updatedAt:new Date(now).toISOString()};
 }));
 return all;
}
export function normalizeScoreboard(data,sport,now=Date.now(),enrichment={}){
 const out=[];
 for(const event of data?.events||[]){
   const contest=event.competitions?.[0],home=contest?.competitors?.find(x=>x.homeAway==='home'),
     away=contest?.competitors?.find(x=>x.homeAway==='away');
   if(!home||!away)continue;
   const clock=Number(event.status?.clock??contest?.status?.clock),period=Number(event.status?.period??contest?.status?.period);
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
   if(lateGame.direction||totals.direction)out.push({id:event.id,event:event.name||'',
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
export async function fetchSportsSignals({fetcher=fetch,now=Date.now(),sports=['NFL','NBA','NHL']}={}){
 const route={NFL:'football/nfl',NBA:'basketball/nba',NHL:'hockey/nhl'};
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
   const markets=await fetchSportsMarkets(fetcher,sport,now);
   return await Promise.all(observations.map(async signal=>{
     const event=live.find(x=>x.id===signal.id),contest=event?.competitions?.[0];
     const home=contest?.competitors?.find(x=>x.homeAway==='home'),
       away=contest?.competitors?.find(x=>x.homeAway==='away');
     let probability={sourceVerified:false,homeProbability:null,awayProbability:null};
     if(signal.lateGame?.direction&&event){
       try{
         const summary=await json(fetcher,`${ESPN}/${route[sport]}/summary?event=${encodeURIComponent(event.id)}`);
         probability=parseLiveWinProbability(summary,event);
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
     const totalProjection=assessTotalsProjection({...signal.gameContext,
       totalLine:signal.totals.totalLine||Number(contest?.odds?.[0]?.overUnder)||null,
       weather:signal.weather,injuries:signal.injuries,now});
     return {...signal,externalWinProbability:prediction,sourceVerified:probability.sourceVerified,
       marketMatchVerified:Boolean(market),market:market||null,
       independentModelSource:probability.sourceVerified?'ESPN_LIVE_MODEL':null,
       modelPlayId:probability.modelPlayId||null,
       totalProjection,kalshiMarketSource:market?'Kalshi public events':'NONE',
       eventKey:game.date?game.sport+':'+game.date+':'+game.awayAbbreviation+':'+game.homeAbbreviation:null};
   }));
  }catch{return []}
 }));
 return outputs.flat().slice(0,30);
}
