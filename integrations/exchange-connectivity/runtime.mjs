import {timingSafeEqual} from 'node:crypto';
import {checkPolymarket} from './check.mjs';

const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});

export function makeHandler(env=process.env,fetcher=fetch,clock=Date.now){
  return async request=>{
    const path=new URL(request.url).pathname;
    if(request.method!=='GET')return reply(405,{error:'Read-only service'});
    if(path==='/'||path==='/health')return reply(200,{
      service:'kal-kings-polymarket-connection',version:1,mode:'READ_ONLY',
      configuration:{key_id_present:Boolean(env.POLYMARKET_KEY_ID?.trim()),
        secret_key_present:Boolean(env.POLYMARKET_SECRET_KEY?.trim()),
        admin_token_present:Boolean(env.KALKINGS_ADMIN_TOKEN&&env.KALKINGS_ADMIN_TOKEN.length>=32)},
      authentication:'NOT_TESTED',live_automation_enabled:false,orders_submitted:0,
    });
    if(path!=='/api/polymarket/check')return reply(404,{error:'Not found'});
    const admin=env.KALKINGS_ADMIN_TOKEN;
    if(!admin||admin.length<32)return reply(503,{error:'Admin access not configured'});
    const actual=Buffer.from(request.headers.get('authorization')||'');
    const expected=Buffer.from(`Bearer ${admin}`);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply(401,{error:'Unauthorized'});
    const result=await checkPolymarket(env,{fetcher,clock});
    return reply(result.status==='VERIFIED'?200:502,{
      exchange:'polymarket_us',authentication:result.status,balance_readable:result.balance_readable,
      live_automation_enabled:false,orders_submitted:0,
    });
  };
}

export default makeHandler();
