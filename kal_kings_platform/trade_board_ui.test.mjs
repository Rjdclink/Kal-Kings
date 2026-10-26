import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
test('Kalshi-only dashboard retains live autonomous fills, risk and manual-order history',()=>{
 for(const id of ['kalshiAutomationCard','soloPositions','soloEligible','soloCashReady','riskBudget','manualHistory','cryptoCycleStatus','scanReason'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.doesNotMatch(html,/DraftKings|draftkings|\/api\/dk\//);
 assert.match(html,/setInterval\(refresh,3000\)/);
 const js=html.match(/<script>([\s\S]+)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new vm.Script(js));
});
test('Kalshi risk display preserves minimum-lot messaging for tiny bankrolls',()=>{
 assert.match(html,/const riskText=policy/);
 assert.match(html,/min-lot eligible/);
 assert.match(html,/riskText\(d\.riskPolicy\)/);
});
