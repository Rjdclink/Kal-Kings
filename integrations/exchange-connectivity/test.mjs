import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, verify, createPublicKey} from 'node:crypto';
import {kalshiHeaders, polymarketHeaders, checkKalshi, checkPolymarket, checkBoth} from './check.mjs';

const kp = generateKeyPairSync('ed25519');
const kalshiPem = kp.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const rawSeed = kp.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32);
const polySecret=rawSeed.toString('base64');
const polyPublic=kp.publicKey;
const fixedTime=()=>1720000000000;

const validKalshi={KALSHI_API_KEY_ID:'test-k-id',KALSHI_PRIVATE_KEY:kalshiPem,KALSHI_ENVIRONMENT:'production'};
const validPoly={POLYMARKET_KEY_ID:'test-p-id',POLYMARKET_SECRET_KEY:polySecret};

const goodFetch=(url,options)=> {
  const path=new URL(url).pathname;
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.ok(!url.includes('test-p-id'));
  if(path.startsWith('/trade-api/v2/')){
    assert.equal(new URL(url).origin,'https://external-api.kalshi.com');
    const signature=Buffer.from(options.headers['KALSHI-ACCESS-SIGNATURE'],'base64');
    assert.equal(verify(null,Buffer.from(`${fixedTime()}GET${path}`),kp.publicKey,signature),true);
    assert.equal(options.headers['KALSHI-ACCESS-KEY'],'test-k-id');
    return Promise.resolve(Response.json({balance:1234}));
  }
  assert.equal(path,'/v1/account/balances');
  assert.equal(new URL(url).origin,'https://api.polymarket.us');
  const signature=Buffer.from(options.headers['X-PM-Signature'],'base64');
  assert.equal(verify(null,Buffer.from(`${fixedTime()}GET${path}`),polyPublic,signature),true);
  assert.equal(options.headers['X-PM-Access-Key'],'test-p-id');
  return Promise.resolve(Response.json({balances:[]}));
};

test('Kalshi Ed25519 signs method/path/timestamp correctly',()=>{
  const headers=kalshiHeaders(validKalshi,'/trade-api/v2/portfolio/balance',fixedTime());
  const signature=Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'],'base64');
  assert.ok(verify(null,Buffer.from('1720000000000GET/trade-api/v2/portfolio/balance'),kp.publicKey,signature));
});
test('Kalshi RSA signs correctly',()=>{
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const headers=kalshiHeaders({...validKalshi,KALSHI_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()},'/trade-api/v2/portfolio/balance',fixedTime());
  assert.ok(verify('sha256',Buffer.from('1720000000000GET/trade-api/v2/portfolio/balance'),{key:keys.publicKey,padding:6,saltLength:32},Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'],'base64')));
});
test('Polymarket US Ed25519 signs correctly',()=>{
  const headers=polymarketHeaders(validPoly,'/v1/account/balances',fixedTime());
  assert.ok(verify(null,Buffer.from('1720000000000GET/v1/account/balances'),polyPublic,Buffer.from(headers['X-PM-Signature'],'base64')));
});
test('both independent authenticated balance checks work',async()=>{
  const result=await checkBoth({...validKalshi,...validPoly},{fetcher:goodFetch,clock:fixedTime});
  assert.equal(result.kalshi.status,'VERIFIED');
  assert.equal(result.polymarket_us.status,'VERIFIED');
  assert.equal(result.kalshi.balance_readable,true);
  assert.equal(result.polymarket_us.balance_readable,true);
});
test('partial secrets fail closed without networking or revealing key values',async()=>{
  let calls=0;
  const result=await checkBoth({KALSHI_API_KEY_ID:'test-k-id',POLYMARKET_SECRET_KEY:polySecret},{fetcher:()=>{calls++; throw Error('must not fetch')}});
  assert.equal(calls,0);
  assert.equal(result.kalshi.status,'NOT_CONFIGURED');
  assert.equal(result.polymarket_us.status,'NOT_CONFIGURED');
  assert.ok(!JSON.stringify(result).includes(polySecret));
});
test('provider errors are isolated and upstream bodies never echoed',async()=>{
  const result=await checkBoth({...validKalshi,...validPoly},{clock:fixedTime,fetcher:async url=>{
    if(url.includes('kalshi.com'))return new Response('very secret upstream',{status:401});
    return Response.json({balances:[{currency:'USD',buyingPower:10}]});
  }});
  assert.equal(result.kalshi.status,'AUTH_REJECTED');
  assert.equal(result.polymarket_us.status,'VERIFIED');
  assert.ok(!JSON.stringify(result).includes('very secret'));
});
test('invalid Polymarket secret fails closed without exposing its value',async()=>{
  const broken={...validPoly,POLYMARKET_SECRET_KEY:'not-a-real-key'};
  const result=await checkPolymarket(broken,{fetcher:()=>{throw Error('must not fetch')}});
  assert.equal(result.status,'INVALID_CONFIGURATION');
  assert.ok(!JSON.stringify(result).includes(broken.POLYMARKET_SECRET_KEY));
});
test('Kalshi escaped PEM line breaks work',async()=>{
  const cfg={...validKalshi,KALSHI_PRIVATE_KEY:kalshiPem.replace(/\n/g,'\\n')};
  const result=await checkKalshi(cfg,{fetcher:goodFetch,clock:fixedTime});
  assert.equal(result.status,'VERIFIED');
});
test('network errors are sanitized',async()=>{
  const result=await checkPolymarket(validPoly,{fetcher:async()=>{throw Error('token=' + polySecret)}});
  assert.equal(result.status,'NETWORK_ERROR');
  assert.ok(!JSON.stringify(result).includes(polySecret));
});
