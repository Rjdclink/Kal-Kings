import test from 'node:test';
import assert from 'node:assert/strict';
import {makeHandler} from './runtime.mjs';

const env={KALKINGS_ADMIN_TOKEN:'a'.repeat(48),POLYMARKET_KEY_ID:'test-key',POLYMARKET_SECRET_KEY:Buffer.alloc(32,1).toString('base64')};
const req=(path='/api/polymarket/check',auth=true,method='GET')=>new Request('https://example.test'+path,{method,headers:auth?{authorization:`Bearer ${env.KALKINGS_ADMIN_TOKEN}`}:{}});

test('public health does not call upstream or disclose keys',async()=>{
  const handler=makeHandler(env,()=>{throw Error('must not fetch');});
  const response=await handler(req('/health',false));
  const body=await response.text();
  assert.equal(response.status,200);
  for(const value of Object.values(env))assert.ok(!body.includes(value));
  assert.equal(JSON.parse(body).authentication,'NOT_TESTED');
});

test('authorization and routes prevent upstream requests',async()=>{
  const handler=makeHandler(env,()=>{throw Error('must not fetch');});
  assert.equal((await handler(req('/api/polymarket/check',false))).status,401);
  assert.equal((await handler(req('/api/polymarket/check',true,'POST'))).status,405);
  assert.equal((await handler(req('/orders'))).status,404);
  assert.equal((await makeHandler({})(req())).status,503);
});

test('authenticated check makes exactly one read-only call and hides balances',async()=>{
  let calls=0;
  const handler=makeHandler(env,async(url,options)=>{
    calls++;
    assert.equal(url,'https://api.polymarket.us/v1/account/balances');
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    return new Response(JSON.stringify({balances:[{balance:'123456.78'}]}));
  });
  const response=await handler(req());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{exchange:'polymarket_us',authentication:'VERIFIED',balance_readable:true,live_automation_enabled:false,orders_submitted:0});
  assert.equal(calls,1);
});

test('rejections and network errors remain sanitized',async()=>{
  for(const [fetcher,status] of [[async()=>new Response('sensitive',{status:401}),'AUTH_REJECTED'],[async()=>{throw Error(env.POLYMARKET_SECRET_KEY);},'NETWORK_ERROR']]){
    const response=await makeHandler(env,fetcher)(req());
    assert.equal(response.status,502);
    const body=await response.json();
    assert.equal(body.authentication,status);
    assert.equal(body.balance_readable,false);
  }
});
