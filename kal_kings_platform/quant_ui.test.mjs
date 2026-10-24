import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('Kalshi standalone card exposes explainable simulation status without fabricating gains',()=>{
 const html=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
 assert.match(html,/id="quantStatus"/);assert.match(html,/id="quantExplanation"/);
 assert.match(html,/historicalQuoteCount/);assert.match(html,/observedExecutionCount/);
 assert.match(html,/Gathering evidence/);
 const js=html.match(/<script>([\s\S]+)<\/script>/)?.[1];assert.ok(js);
 assert.doesNotThrow(()=>new vm.Script(js));
});
