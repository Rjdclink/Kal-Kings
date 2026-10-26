export function selectCryptoIdea(signal,{now=Date.now()}={}){
 if(!signal||!['UP','DOWN'].includes(signal.direction)||!signal.marketTicker)return null;
 const n=Number(signal.agreeingSources),fraction=n===7?.4:n===6?.3:n===5?.2:0;
 if(!fraction||Number(signal.reference?.sourceCount)<5||
    signal.reference?.exactBenchmarkReference!==true)return null;
 const model=signal.model,p=Number(signal.modeledWinProbability);
 const age=now-Date.parse(model?.observedAt||'');
 if(model?.status!=='ESTIMATED'||Number(model.trials)<2500||
    !Number.isFinite(p)||p<.70||p>=1||age<0||age>30000)return null;
 const ticker=signal.marketTicker;
 if(!ticker.startsWith('KX'+signal.symbol+'15M-')||signal.market?.ticker!==ticker)return null;
 return {id:'crypto:'+ticker,eventKey:ticker.split('-').slice(0,2).join('-'),
  strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',symbol:signal.symbol,
  side:signal.direction==='DOWN'?'no':'yes',market:{ticker},
  probability:p,model,agreeingSources:n,allocationFraction:fraction,
  sourceVerified:true,marketMatchVerified:true,updatedAt:signal.updatedAt};
}
