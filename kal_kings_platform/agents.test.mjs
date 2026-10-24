import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENTS,activeAgent,buildAgentBrief} from './agents.mjs';
test('Exactly four public offline models rotate in UTC every six hours',()=>{
  assert.equal(AGENTS.length,4);
  assert.deepEqual([0,6,12,18].map(h=>activeAgent(Date.UTC(2026,9,24,h)).slot),[0,1,2,3]);
  assert.equal(activeAgent(Date.UTC(2026,9,25,0)).slot,0);
  assert.ok(AGENTS.every(a=>a.model.startsWith('onnx-community/')&&a.keyRequired===false));
});
test('Agent brief is bounded, contains market provenance, excludes secrets and orders',()=>{
  const r=buildAgentBrief({kalshi:[{event:'Steelers vs Colts',yesAsk:.45,source:'Kalshi'}],crypto:[{symbol:'ETH/USD',price:3200}],gapCount:0},activeAgent(Date.UTC(2026,9,24,1)));
  assert.ok(r.length<2500);
  assert.match(r,/Steelers/);
  assert.doesNotMatch(r,/API_KEY|PRIVATE_KEY/);
  assert.match(r,/No orders/);
});
