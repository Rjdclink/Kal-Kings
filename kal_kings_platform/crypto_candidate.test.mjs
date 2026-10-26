import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCryptoIdea} from './crypto_candidate.mjs';
test('missing research cannot qualify',()=>assert.equal(selectCryptoIdea(null),null));

const now=Date.parse('2026-10-26T14:00:00Z'),ticker='KXBTC15M-26OCT261415-15';
const signal={symbol:'BTC',direction:'DOWN',agreeingSources:6,allocationFraction:.3,
 marketTicker:ticker,market:{ticker,status:'active'},reference:{sourceCount:6,exactBenchmarkReference:true},
 model:{status:'ESTIMATED',trials:2500,observedAt:new Date(now).toISOString()},
 modeledWinProbability:.93,updatedAt:new Date(now).toISOString()};
test('six independent DOWN votes qualify real NO-side crypto market candidate',()=>{
 const c=selectCryptoIdea(signal,{now});
 assert.equal(c.strategy,'CRYPTO_DIRECTIONAL_CONSENSUS');
 assert.equal(c.side,'no');assert.equal(c.allocationFraction,.3);
});
test('four votes, old simulation, or unmatched ticker cannot enter execution',()=>{
 assert.equal(selectCryptoIdea({...signal,agreeingSources:4},{now}),null);
 assert.equal(selectCryptoIdea({...signal,model:{...signal.model,observedAt:new Date(now-31000).toISOString()}},{now}),null);
 assert.equal(selectCryptoIdea({...signal,marketTicker:'KXETH15M-26OCT261415-15'},{now}),null);
});

test('a positive-value 76 percent modeled-win forecast may enter final price validation',()=>{
 const c=selectCryptoIdea({...signal,modeledWinProbability:.76},{now});
 assert.equal(c?.side,'no');assert.equal(c?.probability,.76);
});
test('model probability below 70 percent does not qualify under broadened forecast cap',()=>{
 assert.equal(selectCryptoIdea({...signal,modeledWinProbability:.69},{now}),null);
});
