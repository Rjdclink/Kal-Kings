// Read-only SharpAPI display adapter. No rankings, stake calculations or order routes.
const URL='https://api.sharpapi.io/api/v1/odds?sportsbook=draftkings&is_live=false&limit=100';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export function normalize(body,now=Date.now()){
 if(!Array.isArray(body?.data))throw Error('Invalid response');
 const events=[];
 for(const r of body.data){
  if(r.sportsbook!=='draftkings'||r.is_active===false||r.is_stale_pregame_price===true)continue;
  if(!Number.isFinite(r.odds_american)||!r.event_id||!r.selection)continue;
  events.push({id:String(r.id),event:String(r.away_team||'')+' @ '+String(r.home_team||''),
   label:String(r.market_type||'')+' · '+String(r.selection)+(r.line==null?'':' '+String(r.line)),
   market:String(r.market_type||''),sport:String(r.league||r.sport||''),start:r.event_start_time||null,
   source:'DraftKings via SharpAPI',updatedAt:r.timestamp||null,observedAt:new Date(now).toISOString(),
   outcomes:[{selection:String(r.selection),american:r.odds_american}]});
 }
 const delay=body.meta?.tier?.data_delay_seconds;
 return {events,issues:[],provider:'SharpAPI',dataDelaySeconds:Number.isFinite(delay)?delay:null,
  hasMore:body.pagination?.has_more===true,observedAt:new Date(now).toISOString()};
}
export function makeHandler(env=process.env,fetcher=fetch,clock=Date.now){
 let cached=null,expires=0,pending=null;
 return async request=>{
  if(request.method!=='GET')return reply({error:'Read-only feed'},405);
  if(new globalThis.URL(request.url).pathname!=='/')return reply({error:'Not found'},404);
  if(!env.SHARPAPI_KEY)return reply({events:[],issues:['SharpAPI key not configured']},503);
  if(cached&&clock()<expires)return reply(cached.body,cached.status);
  if(!pending)pending=(async()=>{
   try{
    const r=await fetcher(URL,{method:'GET',headers:{'X-API-Key':env.SHARPAPI_KEY},redirect:'error',signal:AbortSignal.timeout(9000)});
    if(!r.ok){const reason=r.status===401?'SharpAPI authentication rejected':r.status===403?'SharpAPI access denied':r.status===429?'SharpAPI rate limit reached':'SharpAPI unavailable';return {status:502,body:{events:[],issues:[reason]}};}
    const raw=await r.text();if(raw.length>6000000)throw Error();
    return {status:200,body:normalize(JSON.parse(raw),clock())};
   }catch{return {status:502,body:{events:[],issues:['SharpAPI unavailable or invalid response']}};}
  })().then(result=>{cached=result;expires=clock()+60000;return result;}).finally(()=>{pending=null;});
  const result=await pending;return reply(result.body,result.status);
 };
}
export default makeHandler();
