/** These boosts are decision confidence points, NOT statistically measured win probabilities. */
export function cryptoConfidenceScore(modeledWinProbability,agreeingSources){
 const p=Number(modeledWinProbability),n=Number(agreeingSources);
 const bonusPoints=n===7?30:n===6?20:n===5?15:n===4?10:0;
 if(!Number.isFinite(p)||p<=0||p>=1)return {scorePercent:null,bonusPoints,tradeEligible:false};
 const scorePercent=Number(Math.min(100,p*100+bonusPoints).toFixed(2));
 return {scorePercent,bonusPoints,tradeEligible:n>=5&&scorePercent>=70};
}

export function selectCryptoIdea(signal,{now=Date.now()}={}){
 if(!signal||String(signal.symbol||'').toUpperCase()==='BTC'||!['UP','DOWN'].includes(signal.direction)||!signal.marketTicker)return null;
 const n=Number(signal.agreeingSources),fraction=n===7?.4:n===6?.3:n===5?.2:0;
 if(!fraction||Number(signal.reference?.sourceCount)<5||
    signal.reference?.exactBenchmarkReference!==true||
    !(Number(signal.reference?.referencePrice)>0)||
    !Number.isFinite(Number(signal.reference?.referencePrice)))return null;
 const model=signal.model,p=Number(signal.modeledWinProbability);
 const confidence=cryptoConfidenceScore(p,n);
 const age=now-Date.parse(model?.observedAt||'');
 if(model?.status!=='ESTIMATED'||Number(model.trials)<2500||
    !confidence.tradeEligible||age<0||age>30000)return null;
 const ticker=signal.marketTicker;
 if(!ticker.startsWith('KX'+signal.symbol+'15M-')||signal.market?.ticker!==ticker)return null;
 return {id:'crypto:'+ticker,eventKey:ticker.split('-').slice(0,2).join('-'),
  strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',symbol:signal.symbol,
  side:signal.direction==='DOWN'?'no':'yes',market:{ticker},
  probability:p,model,agreeingSources:n,allocationFraction:fraction,
  confidenceScorePercent:confidence.scorePercent,consensusBonusPoints:confidence.bonusPoints,
  referencePrice:Number(signal.reference.referencePrice),referenceVerified:true,
  sourceVerified:true,marketMatchVerified:true,updatedAt:signal.updatedAt};
}

export function rankCryptoCandidates(signals,{now=Date.now(),max=6}={}){
 return (Array.isArray(signals)?signals:[]).map(signal=>selectCryptoIdea(signal,{now}))
  .filter(Boolean)
  .sort((a,b)=>b.agreeingSources-a.agreeingSources||b.probability-a.probability)
  .slice(0,Math.max(1,Math.min(12,max)));
}
