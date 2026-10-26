import {seeded} from './engine.mjs';
export function runCryptoMonteCarlo({symbol,spotPrice,referencePrice,minutesRemaining,observedAt,now=Date.now(),trials=2500}={}){
 if(!referencePrice||!spotPrice)return {status:'UNVERIFIED_REFERENCE'};
 const age=now-Date.parse(observedAt);
 if(age<0||age>30000)return {status:'STALE_RESEARCH'};
 return {status:'ESTIMATED',trials};
}
