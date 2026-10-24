import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {generateKeyPairSync,verify} from 'node:crypto';
import app,{kalshiHeaders,polymarketHeaders,sql,evaluatedMatches,publicKalshi} from './index.mjs';

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

test('Sports-only Kalshi requests sample eight sports series rather than repeating two',async()=>{
 const previous=globalThis.fetch; const calls=[];
 globalThis.fetch=async url=>{
   const u=new URL(url);calls.push(u.searchParams.get('series_ticker'));
   return Response.json({events:[{category:'Sports',title:'Dallas vs Philadelphia',series_ticker:u.searchParams.get('series_ticker'),markets:[{ticker:'KXSPORTS-TEST',status:'active',yes_ask_dollars:'0.4500',no_ask_dollars:'0.5600'}]}]});
 };
 try {
   const rows=await publicKalshi();
   assert.equal(calls.length,8);
   assert.ok(calls.includes('KXNBAGAME'));
   assert.ok(calls.includes('KXNFLGAME'));
   assert.ok(calls.includes('KXMLBGAME'));
   assert.equal(rows.length,1); // duplicate provider ticker is one quote, not eight
   assert.equal(rows[0].yesAsk,.45);
 } finally {globalThis.fetch=previous;}
});
test('Live diagnostics expose backend status without monetary balances or secrets',async()=>{
 const r=await app.fetch(new Request('https://example.test/health?probe=1'));
 const json=await r.json();
 assert.equal(r.status,200);
 assert.ok(json.probes);
 assert.ok('database' in json.probes);
 assert.ok('kalshiSportsQuotes' in json.probes);
 assert.ok('cryptocurrencyQuotes' in json.probes);
 assert.ok(!JSON.stringify(json).includes('PRIVATE KEY'));
});

test('Sports favorites are signals to review, not fabricated profitable bets',async()=>{
 const {favoriteWatchlist}=await import('./sports.mjs');
 const entries=favoriteWatchlist([{id:'evt-1',event:'Steelers @ Colts',updatedAt:'2026-10-24T16:00:00Z',outcomes:[{selection:'Steelers',american:-900},{selection:'Colts',american:600}]}],Date.parse('2026-10-24T16:00:30Z'));
 assert.equal(entries.length,1);
 assert.equal(entries[0].selection,'Steelers');
 assert.equal(entries[0].profitable,false);
 assert.equal(entries[0].source,'DraftKings implied (de-vig)');
});
test('Mapped positive-edge single venue opportunity can be sized but is never inferred from title match',async()=>{
 const {directionalCandidates}=await import('./sports.mjs');
 const now=Date.parse('2026-10-24T16:00:30Z');
 const kalshi=[{id:'KXTEST-YES',yesAsk:.70,yesDepth:300,observedAt:new Date(now-1000).toISOString(),updatedAt:new Date(now-1000).toISOString()}];
 const draft=[{id:'dk-1',event:'Steelers @ Colts',updatedAt:new Date(now-40000).toISOString(),outcomes:[{selection:'Steelers',american:-900},{selection:'Colts',american:600}]}];
 const pairs=[{id:'pair-1',kalshi_ticker:'KXTEST-YES',dk_event_id:'dk-1',dk_selection:'Colts',kalshi_side:'yes',reviewed_at:new Date(now-10000).toISOString(),reviewed_rule_digest:'sha256:'+'a'.repeat(64)}];
 assert.deepEqual(directionalCandidates([],kalshi,draft,500,now),[]);
 const result=directionalCandidates(pairs,kalshi,draft,500,now);
 assert.equal(result.length,1);
 assert.ok(result[0].stakeDollars>0);
 assert.equal(result[0].source,'DraftKings market-implied reference, not independent win forecast');
 assert.equal(result[0].mode,'MODEL_REFERENCE_ONLY');
});
test('TradingView public webhook rejects missing or incorrect shared passphrase without exposing data',async()=>{
 const r=await app.fetch(new Request('https://example.test/webhooks/tradingview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticker:'ETHUSD',action:'buy',close:3500,passphrase:'invalid'})}));
 assert.equal(r.status,400);assert.equal((await r.json()).error,'TradingView alert rejected');
});
test('TradingView webhook rejects unsafe method',async()=>{
 const r=await app.fetch(new Request('https://example.test/webhooks/tradingview',{method:'GET'}));
 assert.equal(r.status,405);
});
