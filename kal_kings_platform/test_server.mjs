import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {generateKeyPairSync,verify} from 'node:crypto';
import app,{kalshiHeaders,polymarketHeaders,sql,evaluatedMatches} from './index.mjs';

test('Dashboard HTML responds at root with clear Kal Kings name and no embedded secrets',async()=>{
 const res=await app.fetch(new Request('https://example.test/'));
 assert.equal(res.status,200);
 const html=await res.text();
 assert.match(html,/<title>Kal Kings/);
 assert.ok(!html.includes('-----BEGIN PRIVATE KEY-----'));
 assert.match(html, /setInterval\(refresh,3000\)/);
});
test('Dashboard embedded controller JavaScript parses',()=>{
 const html=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
 const s=html.match(/<script>([\s\S]+)<\/script>/)?.[1];
 assert.ok(s&&s.length>1000);
 assert.doesNotThrow(()=>new vm.Script(s));
});
test('Private API unauthenticated and POST blocked',async()=>{
 delete process.env.KALKINGS_ADMIN_TOKEN;
 assert.equal((await app.fetch(new Request('https://example.test/api/state'))).status,401);
 assert.equal((await app.fetch(new Request('https://example.test/health'))).status,200);
});
test('Kalshi signed headers verify with Ed25519 generated key',()=>{
 const kp=generateKeyPairSync('ed25519');
 const env={KALSHI_API_KEY_ID:'stub-id',KALSHI_PRIVATE_KEY:kp.privateKey.export({format:'pem',type:'pkcs8'}).toString()};
 const h=kalshiHeaders('/trade-api/v2/portfolio/balance','GET',1000,env);
 assert.ok(verify(null,Buffer.from('1000GET/trade-api/v2/portfolio/balance'),kp.publicKey,Buffer.from(h['KALSHI-ACCESS-SIGNATURE'],'base64')));
});
test('Polymarket signed headers verify with generated seed',()=>{
 const kp=generateKeyPairSync('ed25519');
 const seed=kp.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64');
 const h=polymarketHeaders('/v1/account/balances','GET',1000,{POLYMARKET_KEY_ID:'x',POLYMARKET_SECRET_KEY:seed});
 assert.ok(verify(null,Buffer.from('1000GET/v1/account/balances'),kp.publicKey,Buffer.from(h['X-PM-Signature'],'base64')));
});
test('Neon SQL layer parameterizes rather than interpolates, uses TLS origin',async()=>{
 let got;
 const json={rows:[{cents:'12000'}]};
 const fetcher=async(u,opts)=>{got={u,opts};return Response.json(json);};
 const rows=await sql('SELECT $1 as cents',['12000'],{url:'postgresql://user:pw@ep-test.us-east-2.aws.neon.tech/king',fetcher});
 assert.equal(rows[0].cents,'12000');
 assert.equal(got.u,'https://ep-test.us-east-2.aws.neon.tech/sql');
 assert.deepEqual(JSON.parse(got.opts.body),{query:'SELECT $1 as cents',params:['12000']});
 assert.equal(got.opts.headers['Neon-Connection-String'],'postgresql://user:pw@ep-test.us-east-2.aws.neon.tech/king');
});
test('Unreviewed quote set cannot produce fabricated profitable opportunities',()=>{
 const k=[{id:'K-1',yesAsk:0.3,updatedAt:new Date().toISOString()}];
 const d=[{id:'DK-1',updatedAt:new Date().toISOString(),outcomes:[{selection:'A',american:200}]}];
 assert.deepEqual(evaluatedMatches([],k,d,100),[]);
});
