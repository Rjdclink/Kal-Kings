import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify,constants} from 'node:crypto';
import {makeHandler} from './index.mjs';
const token='t'.repeat(40);
const request=(path,authorized=true,method='GET')=>new Request('https://local.example'+path,{method,headers:authorized?{authorization:`Bearer ${token}`}:{}});

test('health is honest about missing credentials',async()=>{
  const r=await makeHandler({})(request('/health'));
  const body=await r.json();assert.equal(body.authentication,'NOT_TESTED');assert.equal(body.configuration.private_key_present,false);assert.equal(body.live_automation_enabled,false);
});
test('rejects writes and unknown routes',async()=>{
  const h=makeHandler({});assert.equal((await h(request('/health',true,'POST'))).status,405);assert.equal((await h(request('/orders'))).status,404);
});
test('admin protection and missing credentials',async()=>{
  assert.equal((await makeHandler({})(request('/api/kalshi/check'))).status,503);
  const h=makeHandler({KALKINGS_ADMIN_TOKEN:token});assert.equal((await h(request('/api/kalshi/check',false))).status,401);assert.equal((await h(request('/api/kalshi/check'))).status,503);
});
for(const algorithm of ['ed25519','rsa'])test(`${algorithm} signatures and GET-only authentication`,async()=>{
  const {privateKey,publicKey}=generateKeyPairSync(algorithm,algorithm==='rsa'?{modulusLength:2048}:{});
  const pem=privateKey.export({type:'pkcs8',format:'pem'});
  const env={KALSHI_API_KEY_ID:'fixture-id',KALSHI_PRIVATE_KEY:pem,KALKINGS_ADMIN_TOKEN:token,KALSHI_ENVIRONMENT:'production'};
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    const bytes=Buffer.from(`123GET${new URL(url).pathname}`),signature=Buffer.from(options.headers['KALSHI-ACCESS-SIGNATURE'],'base64');
    assert.equal(algorithm==='ed25519'?verify(null,bytes,publicKey,signature):verify('sha256',bytes,{key:publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},signature),true);
    return Response.json(url.endsWith('balance')?{balance:12345}:{exchange_active:true,trading_active:true});
  };
  const response=await makeHandler(env,fetcher,()=>123)(request('/api/kalshi/check'));const text=await response.text();
  assert.equal(response.status,200);assert.equal(calls,2);assert.equal(JSON.parse(text).authentication,'VERIFIED');assert.ok(!text.includes('12345'));assert.ok(!text.includes('fixture-id'));assert.ok(!text.includes(pem));
});
test('malformed secret is never echoed',async()=>{
  const response=await makeHandler({KALKINGS_ADMIN_TOKEN:token,KALSHI_API_KEY_ID:'test',KALSHI_PRIVATE_KEY:'SECRET-TEST'})(request('/api/kalshi/check'));
  assert.equal(response.status,503);assert.ok(!(await response.text()).includes('SECRET-TEST'));
});
