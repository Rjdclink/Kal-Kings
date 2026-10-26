/** Kal Kings independent live signal-feed adapters. Read-only; never place orders. */
import {cryptoConsensus,planDirectionalTrade,assessLateGame,assessTotals} from './predictive_strategies.mjs';
const KALSHI='https://external-api.kalshi.com/trade-api/v2';
const ESPN='https://site.api.espn.com/apis/site/v2/sports';
const integer=n=>Number.isFinite(Number(n))?Number(n):null;
const timeout=()=>AbortSignal.timeout(7000);
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
  open:integer(r.open),close:integer(r.close)}))
  .filter(r=>r.time!==null&&r.open>0&&r.close>0&&r.time<=Math.floor(now/1000)+120)
  .sort((a,b)=>a.time-b.time);
 const latest=sorted.at(-1),first=sorted.at(-4);
 if(!latest||!first||now-latest.time*1000>360000||
   latest.time-first.time<600||latest.time-first.time>1500)return null;
 return {symbol,source,start:first.open,last:latest.close,observedAt:new Date(now).toISOString(),
   oldestCandleAt:new Date(first.time*1000).toISOString(),newestCandleAt:new Date(latest.time*1000).toISOString()};
}
export async function spotMomentum(fetcher,symbol,now){
 const pair=candidates[symbol];if(!pair)return [];
 const names=['coinbase','kraken','bitstamp'];
 const providers=names.map(async source=>{
  let j,rows;
  if(source==='coinbase'){
   j=await json(fetcher,`https://api.exchange.coinbase.com/products/${pair.coinbase}/candles?granularity=300`);
   rows=Array.isArray(j)?j.map(x=>({time:x[0],open:x[3],close:x[4]})):[];
  }else if(source==='kraken'){
   j=await json(fetcher,`https://api.kraken.com/0/public/OHLC?pair=${pair.kraken}&interval=5`);
   if(j.error?.length)throw Error('Kraken data error');
   const array=Object.values(j.result||{}).find(Array.isArray)||[];
   rows=array.map(x=>({time:x[0],open:x[1],close:x[4]}));
  }else{
   j=await json(fetcher,`https://www.bitstamp.net/api/v2/ohlc/${pair.bitstamp}/?step=300&limit=5`);
   rows=(j.data?.ohlc||[]).map(x=>({time:x.timestamp,open:x.open,close:x.close}));
  }
  return momentum(rows,{symbol,source,now});
 });
 const settled=await Promise.allSettled(providers);
 return settled.filter(x=>x.status==='fulfilled'&&x.value).map(x=>x.value);
}
export async function fetchCryptoSignals({fetcher=fetch,now=Date.now(),symbols=['BTC','ETH','SOL','XRP','DOGE','ADA']}={}){
 const all=await Promise.all(symbols.filter(x=>candidates[x]).map(async symbol=>{
   const [s,m]=await Promise.allSettled([
    spotMomentum(fetcher,symbol,now),
    json(fetcher,`${KALSHI}/events?series_ticker=KX${symbol}15M&status=open&limit=10&with_nested_markets=true`)
   ]);
   const spot=s.status==='fulfilled'?s.value:[],consensus=cryptoConsensus(spot,{symbol,now});
   const markets=m.status==='fulfilled'?(m.value.events||[]).flatMap(e=>(e.markets||[]).map(k=>({
    ticker:k.ticker,seriesTicker:`KX${symbol}15M`,symbol,status:k.status,
    rulesPrimary:k.rules_primary||'',closeTime:k.close_time,
    yesAsk:integer(k.yes_ask_dollars),noAsk:integer(k.no_ask_dollars),
    yesDepth:integer(k.yes_ask_size_fp??k.yes_ask_size),
    noDepth:integer(k.no_ask_size_fp??k.no_ask_size),
    observedAt:new Date(now).toISOString()
   }))):[];
   const available=markets.filter(x=>x.status==='open'&&Date.parse(x.closeTime)-now>90000)
     .sort((a,b)=>Date.parse(a.closeTime)-Date.parse(b.closeTime));
   const market=available[0]||null;
   // Reporting a direction is NOT permission to submit an order: the independent,
   // settlement-calibrated probabilistic model is not yet connected.
   const decision=planDirectionalTrade({consensus,market,bankroll:0,feePerContract:NaN,model:null,now});
   return {symbol,direction:consensus.direction,sources:consensus.sources,
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
   return normalizeScoreboard({...j,events:live},sport,now,{weatherByCity:weatherMap,injuriesByTeam:injuryMap});
  }catch{return []}
 }));
 return outputs.flat().slice(0,30);
}
