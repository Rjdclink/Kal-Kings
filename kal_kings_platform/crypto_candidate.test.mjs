import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCryptoIdea,rankCryptoCandidates,cryptoConfidenceScore} from './crypto_candidate.mjs';
test('missing research cannot qualify',()=>assert.equal(selectCryptoIdea(null),null));

const now=Date.parse('2026-10-26T14:00:00Z'),ticker='KXBTC15M-26OCT261415-15';
const signal={symbol:'BTC',direction:'DOWN',agreeingSources:6,allocationFraction:.3,
 marketTicker:ticker,market:{ticker,status:'active'},reference:{sourceCount:6,exactBenchmarkReference:true,referencePrice:100},
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
test('raw probability below 70 percent may qualify after consensus scoring, but remains the true model estimate',()=>{
 const c=selectCryptoIdea({...signal,modeledWinProbability:.69},{now});
 assert.equal(c.confidenceScorePercent,89);
 assert.equal(c.probability,.69);
});

test('no Kalshi official reference price means no executable crypto opportunity',()=>{
 assert.equal(selectCryptoIdea({...signal,reference:{sourceCount:6,exactBenchmarkReference:true}},{now}),null);
});

test('unanimous seven-venue agreement receives priority ahead of otherwise eligible five-venue ideas',()=>{
 const high={...signal,symbol:'ETH',marketTicker:'KXETH15M-26OCT261415-15',
   market:{ticker:'KXETH15M-26OCT261415-15'},agreeingSources:7,allocationFraction:.4};
 const low={...signal,agreeingSources:5,allocationFraction:.2};
 const ranked=rankCryptoCandidates([low,high],{now});
 assert.equal(ranked.length,2);
 assert.equal(ranked[0].symbol,'ETH');
 assert.equal(ranked[0].allocationFraction,.4);
});

test('consensus adds 10,15,20,30 confidence points while four remains monitor-only',()=>{
 for(const [votes,boost] of [[4,10],[5,15],[6,20],[7,30]]){
  const x=cryptoConfidenceScore(.55,votes);
  assert.equal(x.bonusPoints,boost);assert.equal(x.scorePercent,55+boost);
  const idea=selectCryptoIdea({...signal,agreeingSources:votes,modeledWinProbability:.55},{now});
  assert.equal(Boolean(idea),votes>=5&&(55+boost)>=70);
  if(idea)assert.equal(idea.probability,.55);
 }
});
