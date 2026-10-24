/** Kal Kings — Neon-hosted read-first sports/crypto market command center.
 *  Main branch and research_engine are not modified by this package.
 *  Authenticated routes require KALKINGS_ADMIN_TOKEN; no keys in front end.
 */
import {readFileSync} from 'node:fs';
import {createPrivateKey, sign, timingSafeEqual, createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, constants} from 'node:crypto';
import {evaluatePair,monteCarlo,rankCandidates,quoteAge,validPrice} from './engine.mjs';

const HTML=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
const KALSHI='https://external-api.kalshi.com';
const POLY='https://gateway.polymarket.us';
const SPORTS=['americanfootball_nfl','basketball_nba'];
const TTL={kalshi:3000,polymarket:8000,draftkings:60000,account:6000,crypto:12000,polyaccount:30000};
const LIMIT=200;
const cache=new Map();
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const safeNumber=(x)=>Number.isFinite(Number(x))?Number(x):null;
const str=(x,max=300)=>String(x??'').trim().slice(0,max);
const displayNumber=(x)=>x==null?null:Number(x);
const iso=()=>new Date().toISOString();
const allowEnvToken=req=>{
  const expected=process.env.KALKINGS_ADMIN_TOKEN||'';
  const value=req.headers.get('x-kal-kings-admin')||'';
  const actual=Buffer.from(value), target=Buffer.from(expected);
  return expected.length>=32&&actual.length===target.length&&timingSafeEqual(actual,target);
};
function error(status,code){return reply({error:code},status);}
async function external(url,headers={}){
  const r=await fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw Error(`Provider HTTP ${r.status}`);
  const text=await r.text();
  if(text.length>6000000)throw Error('Provider response too large');
  return JSON.parse(text);
}
async function memo(key,ttl,loader){
  const now=Date.now();const item=cache.get(key);
  if(item&&now-item.time<ttl&&item.data!==undefined)return item.data;
  if(item?.promise)return item.promise;
  const pending=Promise.resolve().then(loader).then(data=>{
    cache.set(key,{time:Date.now(),data,error:null});return data;
  }).catch(ex=>{
    // Error does not silently turn an old cached price into a current one.
    cache.set(key,{time:Date.now(),data:null,error:String(ex.message||'Unavailable').slice(0,120)});
    throw ex;
  });
  cache.set(key,{time:now,promise:pending,data:undefined});return pending;
}
const cachedStatus=key=>({lastFetch:cache.get(key)?.time?new Date(cache.get(key).time).toISOString():null,error:cache.get(key)?.error||null});
const requiredEnv=()=>({
  adminConfigured:Boolean(process.env.KALKINGS_ADMIN_TOKEN?.length>=32),
  kalshiConfigured:Boolean(process.env.KALSHI_API_KEY_ID&&process.env.KALSHI_PRIVATE_KEY),
  polymarketConfigured:Boolean(process.env.POLYMARKET_KEY_ID&&process.env.POLYMARKET_SECRET_KEY),
  oddsFeedConfigured:Boolean(process.env.ODDS_API_KEY),
});

export function kalshiHeaders(path,method='GET',ts=Date.now(),env=process.env){
  if(!env.KALSHI_API_KEY_ID||!env.KALSHI_PRIVATE_KEY)throw Error('Kalshi credentials absent');
  const key=createPrivateKey(env.KALSHI_PRIVATE_KEY.replace(/\\n/g,'\n'));
  const message=Buffer.from(`${ts}${method}${path.split('?')[0]}`);
  let signed;
  if(key.asymmetricKeyType==='ed25519')signed=sign(null,message,key);
  else if(key.asymmetricKeyType==='rsa')signed=sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32});
  else throw Error('Unsupported Kalshi key algorithm');
  return {'KALSHI-ACCESS-KEY':env.KALSHI_API_KEY_ID,
   'KALSHI-ACCESS-TIMESTAMP':String(ts),
   'KALSHI-ACCESS-SIGNATURE':signed.toString('base64')};
}
async function kalshiPrivate(path){
  return external(KALSHI+path,kalshiHeaders(path));
}
export async function publicKalshi(){
  const result=await external(`${KALSHI}/trade-api/v2/events?limit=200&status=open&with_nested_markets=true`);
  const events=Array.isArray(result.events)?result.events:[];
  const rows=[];
  for(const e of events){
    const sport=String(e.category||'').toLowerCase()==='sports';
    if(!sport)continue;
    for(const m of (e.markets||[])){
      if(m.status&&!['active','open'].includes(m.status))continue;
      const yes=safeNumber(m.yes_ask_dollars);
      const no=safeNumber(m.no_ask_dollars);
      if(!validPrice(yes)&&!validPrice(no))continue;
      rows.push({id:str(m.ticker,160),event:str(e.title),label:str(m.yes_sub_title||m.title||m.ticker),
       yesAsk:validPrice(yes)?yes:null,noAsk:validPrice(no)?no:null,
       observedAt:iso(),updatedAt:m.updated_time||e.last_updated_ts||null,
       currency:'USD',ruleHashPresent:Boolean(m.rules_primary||m.rules_secondary),source:'Kalshi',sport:str(e.series_ticker||'Sports',80),
       yesDepth:safeNumber(m.yes_ask_size_fp),noDepth:safeNumber(m.no_ask_size_fp)});
    }
  }
  return rows.slice(0,LIMIT);
}
export async function publicPolymarket(){
  const result=await external(`${POLY}/v1/markets?limit=150&active=true&closed=false&sportsMarketTypes=SPORTS_MARKET_TYPE_MONEYLINE`);
  const markets=Array.isArray(result.markets)?result.markets:[];
  return markets.filter(m=>m.active!==false&&m.closed!==true&&
    (m.sportsMarketTypeV2||m.sportsMarketType||String(m.category||'').toLowerCase().includes('sport')))
    .map(m=>({id:str(m.slug,160),event:str(m.title||m.question||m.slug),label:str(m.subtitle||m.titleShort||m.question||m.slug),
      yesAsk:validPrice(m.bestAskQuote?.value)?Number(m.bestAskQuote.value):null,
      noAsk:null,observedAt:iso(),updatedAt:m.ep3SyncedAt||m.updatedAt||null,
      source:'Polymarket US',sport:str(m.tags?.[0]?.league?.slug||'Sports'),
      note:'Reference only: Kal Kings does not trade or fund Polymarket.'})).filter(m=>m.yesAsk!==null).slice(0,LIMIT);
}
async function cryptoSpot(){
 const products=['BTC-USD','ETH-USD'];
 const all=await Promise.allSettled(products.map(p=>external(`https://api.exchange.coinbase.com/products/${p}/ticker`,{'user-agent':'KalKings/1.0'})));
 return all.flatMap((v,i)=>{
   if(v.status!=='fulfilled'||!Number.isFinite(Number(v.value.price)))return [];
   return [{symbol:products[i].replace('-','/'),price:Number(v.value.price),updatedAt:v.value.time||iso(),source:'Coinbase Exchange (spot reference)'}];
 });
}
export function polymarketHeaders(path,method='GET',ts=Date.now(),env=process.env){
 const keyId=env.POLYMARKET_KEY_ID, secret=env.POLYMARKET_SECRET_KEY;
 if(!keyId||!secret)throw Error('Polymarket US credentials absent');
 const raw=Buffer.from(secret.trim(),'base64');if(raw.length!==32&&raw.length!==64)throw Error('Invalid Polymarket US secret');
 const prefix=Buffer.from('302e020100300506032b657004220420','hex');
 const key=createPrivateKey({key:Buffer.concat([prefix,raw.subarray(0,32)]),format:'der',type:'pkcs8'});
 return {'X-PM-Access-Key':keyId,'X-PM-Timestamp':String(ts),
   'X-PM-Signature':sign(null,Buffer.from(`${ts}${method}${path.split('?')[0]}`),key).toString('base64')};
}
async function polyAccountCheck(){
 if(!requiredEnv().polymarketConfigured)return {status:'NOT_CONFIGURED'};
 try{
  const res=await external('https://api.polymarket.us/v1/account/balances',polymarketHeaders('/v1/account/balances'));
  if(!Array.isArray(res.balances))return {status:'INVALID_RESPONSE'};
  return {status:'VERIFIED'};
 }catch{return {status:'UNAVAILABLE'};}
}
export async function draftKingsOdds(key){
  if(!key)throw Error('Odds provider key missing');
  const results=await Promise.allSettled(SPORTS.map(s=>{
    const u=new URL(`https://api.the-odds-api.com/v4/sports/${s}/odds/`);
    u.search=new URLSearchParams({apiKey:key,regions:'us',markets:'h2h',bookmakers:'draftkings',oddsFormat:'american'}).toString();
    return external(u.href);
  }));
  const events=[];const issues=[];
  for(let i=0;i<results.length;i++){
    const r=results[i];if(r.status!=='fulfilled'){issues.push(`${SPORTS[i]} unavailable`);continue;}
    for(const e of Array.isArray(r.value)?r.value:[]){
      const dk=(e.bookmakers||[]).find(b=>b.key==='draftkings');if(!dk)continue;
      const market=(dk.markets||[]).find(m=>m.key==='h2h');if(!market)continue;
      events.push({id:str(e.id),event:`${e.away_team} @ ${e.home_team}`,home:str(e.home_team),away:str(e.away_team),
        start:e.commence_time,source:'DraftKings via The Odds API',market:'moneyline',updatedAt:market.last_update||dk.last_update||null,
        observedAt:iso(),sport:e.sport_key,
        outcomes:market.outcomes.map(x=>({selection:str(x.name),american:safeNumber(x.price)})).filter(x=>x.american!==null)});
    }
  }
  if(results.every(r=>r.status==='rejected'))throw Error('Odds provider unavailable');
  return {events:events.slice(0,LIMIT),issues};
}

// Neon HTTPS SQL uses the same wire envelope as @neondatabase/serverless.
// SQL parameters, never user-generated SQL fragments.
export async function sql(query,params=[],options={}){
  const conn=options.url??process.env.DATABASE_URL;
  if(!conn)throw Error('Database not configured');
  const url=new URL(conn);
  if(!url.hostname.endsWith('.neon.tech'))throw Error('Unrecognized database host');
  const response=await (options.fetcher??fetch)(`https://${url.hostname}/sql`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),
    headers:{'content-type':'application/json','Neon-Connection-String':conn,'Neon-Raw-Text-Output':'true','Neon-Array-Mode':'false'},
    body:JSON.stringify({query,params}),
  });
  if(!response.ok)throw Error(`Database unavailable (${response.status})`);
  const data=await response.json();
  if(data?.message&&data?.severity==='ERROR')throw Error('Database query rejected');
  return Array.isArray(data.rows)?data.rows:[];
}
async function getBankroll(){
  const rows=await sql("SELECT amount_cents::text AS cents,updated_at FROM kal_kings_bankroll WHERE venue='draftkings'");
  return {amount:rows.length?Number(rows[0].cents)/100:null,updatedAt:rows[0]?.updated_at||null};
}
async function updateBankroll(amount){
  const cents=Math.round(Number(amount)*100);
  if(!Number.isSafeInteger(cents)||cents<0||cents>1e11)throw Error('Balance must be 0 to $1 billion');
  const rows=await sql("INSERT INTO kal_kings_bankroll(venue,amount_cents,updated_at) VALUES ('draftkings',$1,now()) ON CONFLICT(venue) DO UPDATE SET amount_cents=EXCLUDED.amount_cents,updated_at=now() RETURNING amount_cents::text AS cents, updated_at",[String(cents)]);
  return {amount:Number(rows[0].cents)/100,updatedAt:rows[0].updated_at};
}
async function getWagers(){
  const rows=await sql("SELECT id,event_name,selection,odds_american,stake_cents::text AS stake_cents,payout_cents::text AS payout_cents,status,placed_at,settled_at FROM kal_kings_wagers ORDER BY placed_at DESC LIMIT 20");
  return rows.map(row=>({id:row.id,event:row.event_name,selection:row.selection,odds:row.odds_american,
    stake:Number(row.stake_cents)/100,payout:Number(row.payout_cents)/100,status:row.status,placedAt:row.placed_at,settledAt:row.settled_at}));
}
async function recordWager(data){
  const stakeCents=Math.round(Number(data.stake)*100);const odds=Number(data.odds);
  const event=str(data.event,160), selection=str(data.selection,100),id=randomUUID();
  if(!event||!selection||!Number.isInteger(odds)||Math.abs(odds)<100||!Number.isSafeInteger(stakeCents)||stakeCents<1)throw Error('Invalid DraftKings wager');
  const rows=await sql(`WITH debit AS (UPDATE kal_kings_bankroll SET amount_cents=amount_cents-$1::bigint,updated_at=now() WHERE venue='draftkings' AND amount_cents >= $1::bigint RETURNING amount_cents)
    INSERT INTO kal_kings_wagers(id,venue,event_name,selection,odds_american,stake_cents)
    SELECT $2::uuid,'draftkings',$3,$4,$5::int,$1::bigint FROM debit RETURNING id`,[String(stakeCents),id,event,selection,String(odds)]);
  if(!rows.length)throw Error('DraftKings balance insufficient or uninitialized');
  return {id,stake:stakeCents/100};
}
async function settleWager({id,payout}){
  const cents=Math.round(Number(payout)*100);
  if(!/^[0-9a-f-]{36}$/i.test(String(id))||!Number.isSafeInteger(cents)||cents<0)throw Error('Invalid settlement');
  const rows=await sql(`WITH settled AS (UPDATE kal_kings_wagers SET status='settled',payout_cents=$2::bigint,settled_at=now() WHERE id=$1::uuid AND status='open' RETURNING payout_cents), credit AS (UPDATE kal_kings_bankroll SET amount_cents=amount_cents+settled.payout_cents,updated_at=now() FROM settled WHERE venue='draftkings' RETURNING amount_cents) SELECT amount_cents::text AS cents FROM credit`,[id,String(cents)]);
  if(!rows.length)throw Error('Wager not found, already settled, or bankroll missing');
  return {amount:Number(rows[0].cents)/100};
}
async function savePair(data){
  const ticker=str(data.kalshiTicker,128),eventId=str(data.dkEventId,128),selection=str(data.selection,128),side=str(data.side,8).toLowerCase(),digest=str(data.ruleDigest,128);
  if(!/^[A-Z0-9_-]{4,128}$/i.test(ticker)||!eventId||!selection||!['yes','no'].includes(side)||!/^sha256:[0-9a-f]{64}$/i.test(digest))throw Error('Review requires exact event IDs and SHA-256 rules digest');
  const id=randomUUID();
  const rows=await sql('INSERT INTO kal_kings_pairs(id,kalshi_ticker,dk_event_id,dk_selection,kalshi_side,reviewed_rule_digest,reviewed_at) VALUES ($1::uuid,$2,$3,$4,$5,$6,now()) RETURNING id',[id,ticker,eventId,selection,side,digest]);
  return {id:rows[0].id};
}
async function getPairs(){return await sql('SELECT id,kalshi_ticker,dk_event_id,dk_selection,kalshi_side,reviewed_rule_digest,reviewed_at FROM kal_kings_pairs ORDER BY reviewed_at DESC LIMIT 100');}
async function setting(name){const rows=await sql('SELECT value FROM kal_kings_settings WHERE key=$1',[name]);return rows[0]?.value||null;}
async function saveSetting(name,value){return sql('INSERT INTO kal_kings_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',[name,value]);}
function encryptionKey(){const v=process.env.KALKINGS_ADMIN_TOKEN;if(!v||v.length<32)throw Error('Admin secret not configured');return createHash('sha256').update(v).digest();}
function encryptSecret(value){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');}
function decryptSecret(value){const raw=Buffer.from(value,'base64');const iv=raw.subarray(0,12),tag=raw.subarray(12,28);const dec=createDecipheriv('aes-256-gcm',encryptionKey(),iv);dec.setAuthTag(tag);return Buffer.concat([dec.update(raw.subarray(28)),dec.final()]).toString('utf8');}
async function getOddsKey(){if(process.env.ODDS_API_KEY)return process.env.ODDS_API_KEY;try{const raw=await setting('odds_api_key');return raw?decryptSecret(raw):null;}catch{return null;}}
async function getKalshiAccount(){
  if(!requiredEnv().kalshiConfigured)return {status:'NOT_CONFIGURED',balance:null,holdings:[]};
  const [bal,position]=await Promise.all([
    kalshiPrivate('/trade-api/v2/portfolio/balance'),
    kalshiPrivate('/trade-api/v2/portfolio/positions?limit=50')
  ]);
  const value=bal.balance_dollars!=null?Number(bal.balance_dollars):Number(bal.balance)/100;
  if(!Number.isFinite(value)||value<0)throw Error('Unexpected Kalshi balance response');
  const positions=Array.isArray(position.market_positions)?position.market_positions:[];
  return {status:'VERIFIED',balance:value,portfolioValue:bal.portfolio_value==null?null:Number(bal.portfolio_value)/100,
    holdings:positions.slice(0,20).map(p=>({ticker:str(p.ticker),position:safeNumber(p.position_fp??p.position),marketExposure:Number(p.market_exposure_dollars??p.market_exposure??0)})),
    observedAt:iso()};
}

export function evaluatedMatches(pairs,kalshi,draft,dkBalance,now=Date.now()){
  const opportunities=[];
  for(const pair of pairs){
    const km=kalshi.find(m=>m.id===pair.kalshi_ticker);
    const de=draft.find(m=>m.id===pair.dk_event_id);
    const sel=de?.outcomes?.find(o=>o.selection===pair.dk_selection);
    const side=pair.kalshi_side;
    const ask=km?.[side==='yes'?'yesAsk':'noAsk'];
    if(!sel||!validPrice(ask))continue;
    const sportsBookStake=Math.min(50,Number(dkBalance)||0);
    if(sportsBookStake<=0)continue;
    const dec=sel.american>0?1+sel.american/100:1+100/-sel.american;
    const units=Math.round(sportsBookStake*dec);
    if(units<1)continue;
    const assessment=evaluatePair({contracts:units,kalshiAsk:ask,dkStake:sportsBookStake,dkAmerican:sel.american,reviewed:true,sameResolution:true,dkAccepted:false},now);
    const fresh=quoteAge(km,now)<=30000&&quoteAge(de,now)<=120000;
    const reviewedAge=now-new Date(pair.reviewed_at).getTime();
    const withinReview=reviewedAge>=0&&reviewedAge<604800000;
    const candidate={id:pair.id,event:de.event,selection:sel.selection,kalshiTicker:km.id,
      kalshiSide:side,kalshiAsk:ask,dkAmerican:sel.american,
      ...assessment,fresh:fresh&&withinReview,reviewed:withinReview,sameResolution:withinReview,
      funded:dkBalance>=sportsBookStake,quoteUpdatedAt:de.updatedAt,
      // Fees are estimates. This is a conditional candidate, not a claim of guaranteed realized profit.
      disclaimer:'Estimated profit if both legs fill at displayed quotes and reviewed settlement equivalence remains valid.'};
    if(candidate.minimumProfit>0&&candidate.fresh)candidate.monteCarlo=monteCarlo(assessment,{trials:4000,winProbability:.5,secondLegFillProbability:.85});
    opportunities.push(candidate);
  }
  return rankCandidates(opportunities,10);
}
async function state(){
  const [kr,pr,dr,ar,br,wr,pairsr,cr,polyAuth]=await Promise.allSettled([
    memo('kalshi',TTL.kalshi,publicKalshi),
    memo('polymarket',TTL.polymarket,publicPolymarket),
    getOddsKey().then(key=>key?memo('draftkings',TTL.draftkings,()=>draftKingsOdds(key)):{events:[],issues:['Odds API key not configured']}),
    memo('account',TTL.account,getKalshiAccount),getBankroll(),getWagers(),getPairs(),
    memo('crypto',TTL.crypto,cryptoSpot),memo('polyaccount',TTL.polyaccount,polyAccountCheck)
  ]);
  const value=(r,fallback)=>r.status==='fulfilled'?r.value:fallback;
  const k=value(kr,[]),p=value(pr,[]),d=value(dr,{events:[],issues:['Odds provider unavailable']});
  const account=value(ar,{status:'UNAVAILABLE',balance:null,holdings:[]});
  const bankroll=value(br,{amount:null,updatedAt:null});
  const opportunities=evaluatedMatches(value(pairsr,[]),k,d.events,bankroll.amount);
  return {service:'Kal Kings',refreshEveryMs:3000,asOf:iso(),
   providers:{kalshi:{...cachedStatus('kalshi'),count:k.length,ready:kr.status==='fulfilled'},
    polymarket:{...cachedStatus('polymarket'),count:p.length,ready:pr.status==='fulfilled'},
    draftkings:{...cachedStatus('draftkings'),count:d.events.length,ready:dr.status==='fulfilled',issues:d.issues||[]}},
   balances:{kalshi:account.balance,draftkings:bankroll.amount,polymarket:null,updatedAt:bankroll.updatedAt},
   holdings:account.holdings,kalshiStatus:account.status,polymarketStatus:value(polyAuth,{status:'UNAVAILABLE'}).status,crypto:value(cr,[]),
   config:{...requiredEnv(),oddsFeedConfigured:Boolean(await getOddsKey()),neonStorageReady:br.status==='fulfilled'},
   quotes:{kalshi:k,polymarket:p,draftkings:d.events},
   opportunities,wagers:value(wr,[]),
   notes:['Provider quote timestamps determine freshness, not page refresh frequency.',
    'Polymarket US is reference-only with no funded positions.',
    'No cross-venue spread is risk-free until identical settlement rules and both fills are verified.'],
  };
}
export default {
  async fetch(request){
    const u=new URL(request.url),path=u.pathname;
    if(request.method==='GET'&&(path==='/'||path==='/index.html'))return new Response(HTML,{headers:{
      'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer','x-frame-options':'DENY',
      'content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
    if(request.method==='GET'&&path==='/health')return reply({ok:true,service:'Kal Kings',uiServed:true,storageProvider:'Neon',
      credentialsAvailable:requiredEnv(),liveExecutionEnabled:false,asOf:iso()});
    if(request.method==='GET'&&path==='/api/public-state'){
      const crypto=await memo('crypto',TTL.crypto,cryptoSpot).catch(()=>[]);
      return reply({service:'Kal Kings',access:'PUBLIC_READ_ONLY',asOf:iso(),
        balances:{kalshi:null,draftkings:null,polymarket:null},holdings:[],wagers:[],
        kalshiStatus:'PRIVATE',polymarketStatus:'REFERENCE_ONLY',opportunities:[],
        quotes:{kalshi:[],draftkings:[],polymarket:[]},providers:{},crypto});
    }
    if(!path.startsWith('/api/'))return error(404,'Not found');
    if(!allowEnvToken(request))return error(401,'Invalid administrator token');
    if(request.method==='GET'&&path==='/api/session')return reply({authenticated:true,service:'Kal Kings'});
    try{
      if(request.method==='GET'&&path==='/api/state')return reply(await state());
      if(request.method==='GET'&&path==='/api/wagers')return reply({wagers:await getWagers()});
      if(request.method==='GET'&&path==='/api/pairs')return reply({pairs:await getPairs()});
      if(request.method==='POST'&&path==='/api/dk/balance'){
        const body=await request.json();return reply(await updateBankroll(body.amount));
      }
      if(request.method==='POST'&&path==='/api/dk/wager')return reply({created:await recordWager(await request.json())});
      if(request.method==='POST'&&path==='/api/dk/settle')return reply({balance:await settleWager(await request.json())});
      if(request.method==='POST'&&path==='/api/settings/odds-api'){
        const body=await request.json(); const key=str(body.key,128);
        if(key.length<8) return error(400,'Invalid odds API key');
        await saveSetting('odds_api_key',encryptSecret(key));cache.delete('draftkings');
        return reply({saved:true});
      }
      if(request.method==='POST'&&path==='/api/pairs')return reply({created:await savePair(await request.json())});
      if(request.method==='POST'&&path==='/api/simulate'){
        const body=await request.json();
        const pair=evaluatePair(body);
        return reply({pair,simulation:monteCarlo(pair,{trials:5000,winProbability:Number(body.winProbability??.5),secondLegFillProbability:Number(body.fillProbability??.85)})});
      }
      return error(404,'Route not found');
    }catch(e){
      const message=String(e?.message||'Error');
      const validation=/Invalid|not found|insufficient|uninitialized|Balance must/.test(message);
      // Never include provider response body, upstream keys, private key, SQL, or database URL.
      return error(validation?400:503,validation?message:'Service unavailable; check Neon Function configuration and upstream feeds');
    }
  }
};

