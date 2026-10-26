/** Kal Kings strategy research and validation. Signals alone never guarantee execution. */
const num=v=>v===null||v===undefined||v===''?NaN:Number(v);
const finite=n=>Number.isFinite(n);
const round=(n,p=4)=>Number(n.toFixed(p));
const ema=(values,period)=>{const a=2/(period+1);let v=values[0];return values.map((x,i)=>(v=i===0?x:a*x+(1-a)*v));};
export function technicalIndicators(candles){
 const rows=Array.isArray(candles)?[...candles]:[];
 if(rows.length<40)return {status:'INSUFFICIENT_CANDLES',isCalibratedPrediction:false};
 const clean=rows.map(x=>({close:num(x.close),open:num(x.open),high:num(x.high),
    low:num(x.low),volume:num(x.volume)}));
 if(clean.some(x=>!finite(x.close)||x.close<=0||!finite(x.volume)||x.volume<0))
    return {status:'INVALID_CANDLES',isCalibratedPrediction:false};
 const closes=clean.map(x=>x.close),returns=closes.slice(1).map((x,i)=>Math.log(x/closes[i]));
 const e12=ema(closes,12),e26=ema(closes,26),macd=e12.map((x,i)=>x-e26[i]);
 const signal=ema(macd,9),macdHistogram=macd.at(-1)-signal.at(-1);
 const recent=returns.slice(-20),mean=recent.reduce((a,b)=>a+b,0)/recent.length;
 const vol=Math.sqrt(recent.reduce((a,b)=>a+(b-mean)**2,0)/recent.length)*100;
 let gains=0,losses=0;for(let i=closes.length-14;i<closes.length;i++){
   const d=closes[i]-closes[i-1];gains+=Math.max(0,d);losses+=Math.max(0,-d);}
 const rsi=losses===0?100:100-100/(1+gains/losses);
 const volumes=clean.slice(-21).map(x=>x.volume);
 const avg=volumes.slice(0,-1).reduce((a,b)=>a+b,0)/20;
 const volumeRatio=avg>0?volumes.at(-1)/avg:0;
 const change15MinutesPct=(closes.at(-1)/closes.at(-4)-1)*100;
 return {status:'OK',rsi:round(rsi,2),macd:round(macd.at(-1),5),
   macdSignal:round(signal.at(-1),5),macdHistogram:round(macdHistogram,6),
   realizedVolatilityPct:round(vol,4),volumeRatio:round(volumeRatio,3),
   change15MinutesPct:round(change15MinutesPct,3),isCalibratedPrediction:false};
}
export function assessCryptoRegime(consensus,technical){
 const base={direction:'UNKNOWN',regime:'UNVERIFIED',signalStrength:0,
   estimatedWinProbability:null,eligibleForAutomation:false,reason:'INSUFFICIENT_INPUT'};
 if(!technical||technical.status!=='OK'||!consensus||consensus.sources<3||
    consensus.agreement<.75||!['UP','DOWN'].includes(consensus.direction))return base;
 const up=consensus.direction==='UP',rsi=technical.rsi,macd=technical.macdHistogram;
 const trendAligned=up?macd>0:macd<0;
 const saneRsi=up?(rsi>=40&&rsi<78):(rsi<=60&&rsi>22);
 const goodVol=technical.realizedVolatilityPct<5;
 const goodVolume=technical.volumeRatio>=.6;
 const flags=[trendAligned,saneRsi,goodVol,goodVolume];
 const score=flags.filter(Boolean).length/flags.length;
 return {...base,direction:score>=.75?consensus.direction:'MIXED',
   regime:score>=.75?'TREND_FOLLOWING':'MIXED_INDICATORS',
   signalStrength:round(score),reason:'HISTORICAL_SIGNAL_ONLY',
   factors:{trendAligned,saneRsi,goodVol,goodVolume},
   note:'Momentum strength is not a future win probability or independently calibrated expected return.'};
}
export function walkForwardScore(rows,{minTraining=50,minHoldout=20}={}){
 const valid=(Array.isArray(rows)?rows:[]).filter(x=>{
   const p=num(x.probability),m=num(x.marketProbability);
   return typeof x?.won==='boolean'&&finite(Date.parse(x.at||''))&&finite(p)&&p>0&&p<1&&
      finite(m)&&m>0&&m<1;
 }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 if(valid.length<minTraining+minHoldout)return {status:'INSUFFICIENT_RESOLVED_SAMPLE',count:valid.length};
 const train=Math.max(minTraining,Math.floor(valid.length*.7));
 if(valid.length-train<minHoldout)return {status:'INSUFFICIENT_RESOLVED_SAMPLE',count:valid.length};
 const hold=valid.slice(train);const mean=fn=>round(hold.reduce((s,x)=>s+fn(x),0)/hold.length,6);
 const brier=mean(x=>(num(x.probability)-Number(x.won))**2);
 const marketBrier=mean(x=>(num(x.marketProbability)-Number(x.won))**2);
 const lossRate=mean(x=>x.won?0:1);
 return {status:'EVALUATED_HOLDOUT',sampleCount:valid.length,trainingCount:train,
   holdoutCount:hold.length,holdoutBrier:brier,marketHoldoutBrier:marketBrier,
   holdoutLossFrequency:lossRate,improvesMarket:brier<marketBrier,
   executionApproved:false,
   note:'A historical holdout measurement is not a promise about future win probabilities.'};
}
