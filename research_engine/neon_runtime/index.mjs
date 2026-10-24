import {createPrivateKey, sign, constants, timingSafeEqual} from 'node:crypto';

const HOSTS={production:'https://external-api.kalshi.com',demo:'https://external-api.demo.kalshi.co'};
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});

export function makeHandler(env=process.env,fetcher=fetch,clock=Date.now){
  const configuration=()=>({
    environment:env.KALSHI_ENVIRONMENT||'demo',
    key_id_present:Boolean(env.KALSHI_API_KEY_ID?.trim()),
    private_key_present:Boolean(env.KALSHI_PRIVATE_KEY?.trim()),
    admin_token_present:Boolean(env.KALKINGS_ADMIN_TOKEN?.trim()),
  });
  return async request=>{
    const path=new URL(request.url).pathname;
    if(request.method!=='GET')return reply(405,{error:'Read-only service'});
    if(path==='/health'||path==='/')return reply(200,{
      service:'kal-kings-connection',version:1,mode:'READ_ONLY',
      configuration:configuration(),authentication:'NOT_TESTED',
      live_automation_enabled:false,orders_submitted:0,
    });
    if(path!=='/api/kalshi/check')return reply(404,{error:'Not found'});
    const admin=env.KALKINGS_ADMIN_TOKEN;
    if(!admin||admin.length<32)return reply(503,{error:'Admin access not configured'});
    const actual=Buffer.from(request.headers.get('authorization')||'');
    const expected=Buffer.from(`Bearer ${admin}`);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply(401,{error:'Unauthorized'});
    const config=configuration();
    if(!config.key_id_present||!config.private_key_present||!HOSTS[config.environment])return reply(503,{error:'Kalshi runtime credentials or environment missing',live_automation_enabled:false});
    let key;
    try{
      key=createPrivateKey(env.KALSHI_PRIVATE_KEY.replace(/\\n/g,'\n'));
      if(!['rsa','ed25519'].includes(key.asymmetricKeyType))throw Error();
    }catch{return reply(503,{error:'Invalid Kalshi private-key configuration'});}
    const get=async path=>{
      const timestamp=String(clock());
      const message=Buffer.from(`${timestamp}GET${path}`);
      const signature=key.asymmetricKeyType==='ed25519'
        ?sign(null,message,key)
        :sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32});
      const response=await fetcher(HOSTS[config.environment]+path,{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{'KALSHI-ACCESS-KEY':env.KALSHI_API_KEY_ID.trim(),
          'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':signature.toString('base64')},
      });
      if(!response.ok)throw Error('Upstream rejected request');
      const body=await response.text();
      if(body.length>1000000)throw Error('Oversized response');
      return JSON.parse(body);
    };
    try{
      const status=await get('/trade-api/v2/exchange/status');
      const balance=await get('/trade-api/v2/portfolio/balance');
      if(!Number.isSafeInteger(balance.balance)||balance.balance<0)throw Error('Invalid response');
      return reply(200,{environment:config.environment,authentication:'VERIFIED',
        exchange_active:status.exchange_active===true,trading_active:status.trading_active===true,
        balance_readable:true,live_automation_enabled:false,orders_submitted:0});
    }catch{return reply(502,{error:'Kalshi readiness check failed; no credentials or upstream body logged',live_automation_enabled:false});}
  };
}

export default makeHandler();
