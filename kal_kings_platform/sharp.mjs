/** SharpAPI is a sportsbook *odds* provider. It cannot submit DraftKings bets. */
import {createHash} from 'node:crypto';

const SHARP_FEED='https://br-weathered-rain-b5vxpp21-sharpapifeed.compute.c-7.us-east-2.aws.neon.tech/';
const moneyline=(name)=>/^(?:moneyline|h2h|1st_half_moneyline|2nd_half_moneyline)$/.test(name);
const label=(v)=>String(v??'').trim().slice(0,180);

export function normalizeSharpOdds(data,when=new Date().toISOString()){
  const inputs=Array.isArray(data?.events)?data.events:[];
  const map=new Map();
  const sports=new Set();
  for(const r of inputs){
    const sport=label(r.sport).toLowerCase();
    if(!sport||sport.includes('crypto')||sport.includes('politic'))continue;
    const market=label(r.market).toLowerCase();
    const event=label(r.event);if(!event||!moneyline(market))continue;
    // The SharpAPI free tier can publish rows per market selection, so group them
    // by *same event, same game start and SAME market*. Never combine half and full game.
    const key=[event,market,label(r.start),sport].join('|').toLowerCase();
    let target=map.get(key);
    if(!target){target={id:'sharp-'+createHash('sha256').update(key).digest('hex').slice(0,20),
      event,market,sport,start:r.start||null,source:'DraftKings via SharpAPI',sportsbook:'draftkings',
      updatedAt:r.updatedAt||null,observedAt:r.observedAt||when,
      wageringApi:false,wagerExecutionAvailable:false,oddsDelayed:true,outcomes:[]};map.set(key,target);}
    for(const value of Array.isArray(r.outcomes)?r.outcomes:[]){
      const american=Number(value.american),selection=label(value.selection);
      if(!selection||!Number.isFinite(american)||!Number.isInteger(american)||Math.abs(american)<100||Math.abs(american)>100000)continue;
      if(!target.outcomes.some(x=>x.selection.toLowerCase()===selection.toLowerCase()))target.outcomes.push({selection,american});
    }
    sports.add(sport);
    const t=Date.parse(r.updatedAt||'');
    if(Number.isFinite(t)&&t>Date.parse(target.updatedAt||''))target.updatedAt=r.updatedAt;
  }
  const events=[...map.values()].filter(x=>x.outcomes.length).sort((a,b)=>{
    // Promote whole-game markets and distinct sports, not repetitive first-half lines.
    const val=m=>m.market==='moneyline'?1:0;
    return val(b)-val(a)||String(a.start||'').localeCompare(String(b.start||''));
  }).slice(0,200);
  return {events,issues:Array.isArray(data?.issues)?data.issues:[],hasMore:Boolean(data?.hasMore),
    provider:'SharpAPI odds reference (not wagering API)',observedAt:data?.observedAt||when,
    sourceSports:[...sports]};
}

export async function sharpFeedOdds({fetcher=fetch,url=SHARP_FEED}={}){
  if(url!==SHARP_FEED)throw Error('Untrusted SharpAPI service origin');
  try{
    const response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(9000)});
    if(!response.ok)return {events:[],issues:[`SharpAPI service HTTP ${response.status}`],provider:'SharpAPI',sourceSports:[]};
    const text=await response.text();
    if(text.length>5000000)throw Error('Too many odds records');
    return normalizeSharpOdds(JSON.parse(text),new Date().toISOString());
  }catch{return {events:[],issues:['SharpAPI odds service unavailable'],provider:'SharpAPI',sourceSports:[]};}
}
