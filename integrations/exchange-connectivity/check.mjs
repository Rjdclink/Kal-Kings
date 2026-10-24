/**
 * Kal Kings: authenticated, read-only health checks for Kalshi and Polymarket US.
 * No exchange credentials or balances are ever printed or persisted.
 * This module never submits, changes, or cancels orders.
 */
import {createPrivateKey, sign, constants} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const KALSHI_ORIGINS=Object.freeze({
  production:'https://external-api.kalshi.com',
  demo:'https://external-api.demo.kalshi.co',
});
const POLYMARKET_ORIGIN='https://api.polymarket.us';
const KALSHI_BALANCE='/trade-api/v2/portfolio/balance';
const POLYMARKET_BALANCE='/v1/account/balances';
const boolValue=value=>typeof value==='string'&&value.trim().length>0;
const time=()=>Date.now();

const failure=(status,details)=>({status,balance_readable:false,...(details?{details}:{})});
const success=()=>({status:'VERIFIED',balance_readable:true});

export function kalshiHeaders(env,path,ts=time()){
  if(!boolValue(env.KALSHI_API_KEY_ID)||!boolValue(env.KALSHI_PRIVATE_KEY))throw Error('Invalid Kalshi credentials');
  const key=createPrivateKey(env.KALSHI_PRIVATE_KEY.replace(/\\n/g,'\n'));
  if(!['rsa','ed25519'].includes(key.asymmetricKeyType))throw Error('Unsupported Kalshi key');
  const message=Buffer.from(`${ts}GET${path}`);
  const signature=key.asymmetricKeyType==='ed25519'
    ?sign(null,message,key)
    :sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32});
  return {
    'KALSHI-ACCESS-KEY':env.KALSHI_API_KEY_ID.trim(),
    'KALSHI-ACCESS-TIMESTAMP':String(ts),
    'KALSHI-ACCESS-SIGNATURE':signature.toString('base64'),
  };
}

export function polymarketHeaders(env,path,ts=time()){
  if(!boolValue(env.POLYMARKET_KEY_ID)||!boolValue(env.POLYMARKET_SECRET_KEY))throw Error('Invalid Polymarket credentials');
  const raw=Buffer.from(env.POLYMARKET_SECRET_KEY.trim(),'base64');
  if(raw.length!==32&&raw.length!==64)throw Error('Invalid Polymarket secret encoding');
  // Polymarket US keys are Ed25519 seeds, not Kalshi-style PEM keys.
  const prefix=Buffer.from('302e020100300506032b657004220420','hex');
  const key=createPrivateKey({key:Buffer.concat([prefix,raw.subarray(0,32)]),format:'der',type:'pkcs8'});
  const signature=sign(null,Buffer.from(`${ts}GET${path}`),key);
  return {
    'X-PM-Access-Key':env.POLYMARKET_KEY_ID.trim(),
    'X-PM-Timestamp':String(ts),
    'X-PM-Signature':signature.toString('base64'),
  };
}

function classifyResponse(status){
  if(status===401)return failure('AUTH_REJECTED');
  if(status===403)return failure('PERMISSION_DENIED');
  if(status===429)return failure('RATE_LIMITED');
  return failure('HTTP_ERROR',{http_status:status});
}

async function getJSON(origin,path,headers,fetcher){
  // Both origins and paths are constants; never accept user-supplied URLs or redirects.
  const response=await fetcher(origin+path,{
    method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000),
  });
  if(!response.ok)return {error:classifyResponse(response.status)};
  const body=await response.text();
  if(body.length>500_000) return {error:failure('INVALID_RESPONSE')};
  try{return {body:JSON.parse(body)};}
  catch{return {error:failure('INVALID_RESPONSE')};}
}

export async function checkKalshi(env=process.env,{fetcher=fetch,clock=time}={}){
  if(!boolValue(env.KALSHI_API_KEY_ID)||!boolValue(env.KALSHI_PRIVATE_KEY))return failure('NOT_CONFIGURED');
  const environment=env.KALSHI_ENVIRONMENT||'production';
  const origin=KALSHI_ORIGINS[environment];
  if(!origin)return failure('INVALID_CONFIGURATION');
  let headers;
  try{headers=kalshiHeaders(env,KALSHI_BALANCE,clock());}
  catch{return failure('INVALID_CONFIGURATION');}
  try{
    const result=await getJSON(origin,KALSHI_BALANCE,headers,fetcher);
    if(result.error)return result.error;
    const value=result.body?.balance;
    if(!Number.isSafeInteger(value)||value<0)return failure('INVALID_RESPONSE');
    return success();
  }catch{return failure('NETWORK_ERROR');}
}

export async function checkPolymarket(env=process.env,{fetcher=fetch,clock=time}={}){
  if(!boolValue(env.POLYMARKET_KEY_ID)||!boolValue(env.POLYMARKET_SECRET_KEY))return failure('NOT_CONFIGURED');
  let headers;
  try{headers=polymarketHeaders(env,POLYMARKET_BALANCE,clock());}
  catch{return failure('INVALID_CONFIGURATION');}
  try{
    const result=await getJSON(POLYMARKET_ORIGIN,POLYMARKET_BALANCE,headers,fetcher);
    if(result.error)return result.error;
    if(!Array.isArray(result.body?.balances))return failure('INVALID_RESPONSE');
    return success();
  }catch{return failure('NETWORK_ERROR');}
}

export async function checkBoth(env=process.env,dependencies={}){
  const [kalshi,polymarket_us]=await Promise.all([
    checkKalshi(env,dependencies),checkPolymarket(env,dependencies),
  ]);
  return {kalshi,polymarket_us};
}

export async function main(){
  const status=await checkBoth();
  for(const [exchange,entry] of Object.entries(status)){
    process.stdout.write(`${exchange}: ${entry.status}${entry.details?.http_status?` (${entry.details.http_status})`:''}\n`);
  }
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Kal Kings exchange connection check\n\n| Exchange | Authenticated balance read | Status |\n|---|---|---|\n`+
      Object.entries(status).map(([name,entry])=>`| ${name} | ${entry.balance_readable?'Yes':'No'} | ${entry.status} |`).join('\n')+'\n\nRead-only; no orders submitted.\n');
  }
  if(Object.values(status).some(entry=>entry.status!=='VERIFIED'))process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await main();
}
