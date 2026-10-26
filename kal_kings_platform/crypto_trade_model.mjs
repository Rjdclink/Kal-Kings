import {seeded} from './engine.mjs';
export function runCryptoMonteCarlo({symbol,spotPrice,referencePrice,minutesRemaining,observedAt,now=Date.now(),trials=2500}={}){
 if(!referencePrice||!spotPrice)return {status:'UNVERIFIED_REFERENCE'};
 const age=now-Date.parse(observedAt);
 if(age<0||age>30000)return {status:'STALE_RESEARCH'};
 const price=Number(spotPrice),reference=Number(referencePrice),minutes=Number(minutesRemaining);
 if(!['BTC','ETH','SOL','XRP','DOGE','ADA'].includes(symbol)||
    !Number.isFinite(price)||price<=0||!Number.isFinite(reference)||reference<=0||
    !Number.isFinite(minutes)||minutes<=0||minutes>15||
    !Number.isInteger(trials)||trials<100||trials>20000)
   return {status:'UNVERIFIED_REFERENCE'};
 const rng=seeded(17),normal=()=>{
  const x=Math.max(1e-12,rng()),y=rng();
  return Math.sqrt(-2*Math.log(x))*Math.cos(2*Math.PI*y);
 };
 const sigma=.0035*Math.sqrt(minutes/5),gap=Math.log(price/reference);
 let wins=0;
 for(let i=0;i<trials;i++)if(gap+sigma*normal()+.0015*normal()>=0)wins++;
 const p=(wins+.5)/(trials+1),error=1.645*Math.sqrt(p*(1-p)/trials);
 return {status:'ESTIMATED',trials,yesProbability:p,
   lowerYesProbability:Math.max(0,p-error),upperYesProbability:Math.min(1,p+error),
   observedAt,validUntil:new Date(Date.parse(observedAt)+30000).toISOString(),
   benchmark:'SPOT_PROXY_NOT_CF_BENCHMARKS',historicalEvidence:'SECONDARY'};
}
