import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');

test('dashboard shows Kalshi filled awaiting settlement orders and recent settlements separately',()=>{
 for(const id of ['pendingSettlementsCard','pendingPositions','pendingCount',
 'recentSettlementsCard','recentSettlementRows','kBalance','kPendingCount','kLastPayout'])
  assert.ok(html.includes('id="'+id+'"'),id);
});
test('DraftKings trading controls and cards are not on the dashboard',()=>{
 assert.doesNotMatch(html,/DraftKings|draftkings|Polymarket US|\/api\/dk\/|PREPARE_DRAFTKINGS/);
 for(const id of ['balanceForm','tradeShortlist','wagerForm','pairForm','dBalance','combined','autoOrders']){
  assert.ok(!html.includes('id="'+id+'"'),id);
 }
});
test('manual Kalshi trading and automatic crypto and sports diagnostics still render',()=>{
 for(const id of ['manualKalshiForm','manualHistory','kalshiAutomationCard','cryptoCycleStatus','predictiveCards','aiAnalyze','tvForm','crawlerSources'])
  assert.ok(html.includes('id="'+id+'"'),id);
 for(const route of ['/api/kalshi/manual/preview','/api/kalshi/manual/execute','/api/automation/tick'])
  assert.ok(html.includes(route),route);
 assert.match(html,/setInterval\(refresh,3000\)/);
 const source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(source);assert.doesNotThrow(()=>new vm.Script(source));
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const referenced=[...html.matchAll(/\$\('#([^']+)'\)/g)].map(x=>x[1]);
 assert.deepEqual([...new Set(referenced.filter(id=>!ids.has(id)))],[]);
});