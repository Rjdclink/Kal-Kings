import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');

test('separate top eligible trade selection card exists and binds real actions',()=>{
 assert.match(html, /id="tradeShortlistCard"/);
 assert.match(html, /id="tradeShortlist"/);
 assert.match(html, /id="shortlistCount"/);
 assert.match(html, /data-shortlist/);
 assert.match(html, /PREPARE_DRAFTKINGS/);
 assert.match(html, /id="wPairId"/);
});
test('automated executed trade card distinguishes confirmed fills and unknown states',()=>{
 for(const id of ['kalshiAutomationCard','autoOrders','confirmedOrders','confirmedContracts','settledPnL','noFundsNote']) assert.ok(html.includes(`id="${id}"`), id);
 assert.match(html, /orders\.length\?orders\.slice/);
 assert.match(html, /o\.filled>0/);
 assert.match(html, /Awaiting settlements/);
});
test('bankroll and 3-second polling remain functional',()=>{
 assert.match(html, /id="balanceForm"/);
 assert.match(html, /\/api\/dk\/balance/);
 assert.match(html, /setInterval\(refresh,3000\)/);
 const script=html.match(/<script>([\s\S]+)<\/script>/)?.[1];
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script));
});

test('risk display communicates min-lot eligibility without showing misleading $0.00 cap',()=>{
 assert.match(html,/const riskText=policy/);
 assert.match(html,/min-lot eligible/);
 assert.match(html,/riskText\(d\.riskPolicy\)/);
});
