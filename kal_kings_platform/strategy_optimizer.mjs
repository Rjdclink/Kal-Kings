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

const shortDate=date=>{
 if(!/^\d{4}-\d\d-\d\d$/.test(date||''))return null;
 const d=new Date(date+'T12:00:00Z');
 if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==date)return null;
 return String(d.getUTCDate()).padStart(2,'0')+
  ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()]+
  String(d.getUTCFullYear()%100).padStart(2,'0');
};
export function matchSportsOutcome(event,market){
 const denied={matched:false,reason:'UNVERIFIED_EVENT_IDENTITY'};
 const prefixes={NFL:'KXNFLGAME',NBA:'KXNBAGAME',NHL:'KXNHLGAME'};
 const prefix=prefixes[event?.sport],date=shortDate(event?.date);
 const home=String(event?.homeAbbreviation||'').toUpperCase(),
   away=String(event?.awayAbbreviation||'').toUpperCase(),
   selected=String(event?.selectedAbbreviation||'').toUpperCase();
 if(!prefix||!date||!home||!away||home===away||![home,away].includes(selected)||
    !/^[A-Z]{2,4}$/.test(home)||!/^[A-Z]{2,4}$/.test(away))return denied;
 const ticker=String(market?.ticker||market?.id||'').toUpperCase();
 const expected1=prefix+'-'+date+away+home+'-'+selected;
 const expected2=prefix+'-'+date+home+away+'-'+selected;
 return ticker===expected1||ticker===expected2?{matched:true,reason:'EXACT_DATE_TEAMS_AND_OUTCOME',
   ticker,eventKey:prefix+'-'+date+away+home}:denied;
}
/** A possible value entry must be backed by a separately sourced live
 * win-probability estimate AND a verified, presently executable order quote.
 * It never derives independent probability from the Kalshi ask itself.
 */
export function assessKalshiValue({
 market,side,probability,probabilitySource,sourceVerified=false,
 marketMatchVerified=false,bankroll,holdings,feePerContract,
 now=Date.now(),maxLossProbability=.30,minimumEdge=0,maxBankrollFraction=null
}={}){
 const no=(reason,extra={})=>({allowed:false,reason,...extra});
 if(!marketMatchVerified||sourceVerified!==true||
   !['ESPN_LIVE_MODEL','CRYPTO_SCENARIO_PROXY'].includes(probabilitySource))
   return no('INDEPENDENT_MODEL_OR_RULES_UNVERIFIED');
 const p=num(probability),cash=num(bankroll),fee=num(feePerContract);
 if(!finite(p)||p<=0||p>=1||p<1-maxLossProbability-1e-9)
   return no('MODELED_LOSS_EXCEEDS_LIMIT');
 if(!finite(cash)||cash<=0||!finite(fee)||fee<0)return no('CASH_OR_FEES_UNVERIFIED');
 if(!['yes','no'].includes(side)||!['open','active'].includes(market?.status))
   return no('MARKET_NOT_TRADABLE');
 const age=now-Date.parse(market?.observedAt||'');
 if(!finite(age)||age<0||age>3000)return no('STALE_KALSHI_QUOTE');
 const px=num(market[side+'Ask']),depth=num(market[side+'Depth']);
 if(!finite(px)||px<=0||px>=1||!finite(depth)||depth<1)
   return no('INSUFFICIENT_EXECUTABLE_DEPTH');
 if(!Array.isArray(holdings))return no('HOLDINGS_UNVERIFIED');
 if(holdings.some(x=>x?.ticker===market.ticker&&num(x.position)!==0))
   return no('EXISTING_EVENT_EXPOSURE');
 const debit=px+fee,edge=p-debit;
 if(edge<=Math.max(0,minimumEdge)+1e-9)return no('NO_NET_POSITIVE_EDGE',{edge:round(edge)});
 const fraction=probabilitySource==='CRYPTO_SCENARIO_PROXY'?
   num(maxBankrollFraction):null;
 if(fraction!==null&&(!finite(fraction)||fraction<.2||fraction>.4))
   return no('INVALID_CONSENSUS_RISK_TIER');
 const budget=Math.min(cash,fraction===null?(cash<100?cash*.25:cash*.02):cash*fraction);
 if(debit>budget+1e-9)return no('INSUFFICIENT_RISK_BUDGET');
 const count=probabilitySource==='CRYPTO_SCENARIO_PROXY'?
   Math.min(50,Math.floor(depth),Math.floor(budget/debit)):
   cash<100?1:Math.min(Math.floor(depth),Math.floor(cash/debit),Math.floor(budget/debit),10);
 if(count<1)return no('INSUFFICIENT_CAPITAL');
 return {allowed:true,reason:'INDEPENDENT_VALUE_APPROVED',
   strategy:probabilitySource==='CRYPTO_SCENARIO_PROXY'?'CRYPTO_DIRECTIONAL_CONSENSUS':'LIVE_SPORTS_VALUE',
   ticker:market.ticker,side,contracts:count,limitPrice:px,feePerContract:fee,
   estimatedMaxDebitDollars:round(debit*count,4),
   expectedNetDollars:round(edge*count,4),modeledLossFrequency:round(1-p),
   modeledWinProbability:round(p),marketProbability:round(px),
   confirmation:'Live independently sourced estimate, not a guaranteed return',
   note:'A live forecast is uncertain and must be rechecked before placing an order.'};
}
/** Simple transparent live-score projection. Not calibrated; research only. */
export function assessTotalsProjection({
 sport,totalLine,homeScore,awayScore,period,clockSeconds,state='in',updatedAt,
 weather={},injuries=[],now=Date.now()
}={}){
 const base={status:'INSUFFICIENT_CONTEXT',direction:null,
   estimatedUnderProbability:null,eligibleForAutomation:false};
 const league={NFL:{periods:4,seconds:900,sigma:12},NBA:{periods:4,seconds:720,sigma:20},
   NHL:{periods:3,seconds:1200,sigma:3}}[sport];
 const h=num(homeScore),a=num(awayScore),line=num(totalLine),per=num(period),
   clk=num(clockSeconds),age=now-Date.parse(updatedAt||'');
 if(!league||state!=='in'||!finite(h)||!finite(a)||h<0||a<0||
    !finite(line)||line<=0||!finite(per)||per<1||per>league.periods||
    !finite(clk)||clk<0||clk>league.seconds||
    !finite(age)||age<0||age>90000)return base;
 const elapsed=(per-1)*league.seconds+(league.seconds-clk),total=league.periods*league.seconds;
 if(elapsed<=0)return base;
 const remaining=total-elapsed,observed=h+a;
 const rawRate=observed/elapsed;
 let factor=1;const factors=[];
 if(sport==='NFL'&&weather?.indoor!==true){
   if(num(weather.windMph)>=18){factor*=.86;factors.push('Strong wind');}
   if(num(weather.precipitationMm)>=4){factor*=.92;factors.push('Heavy precipitation');}
 }
 for(const x of Array.isArray(injuries)?injuries:[]){
   if(['out','inactive'].includes(String(x?.status||'').toLowerCase())&&
     ['QB','RB1','WR1','PG','C'].includes(String(x?.role||'').toUpperCase())){
     factor*=.96;factors.push('Verified offensive absence');}
 }
 const projected=observed+rawRate*remaining*factor;
 const sigma=league.sigma*Math.max(.35,Math.sqrt(remaining/total));
 const z=(line-projected)/sigma;
 const under=1/(1+Math.exp(-1.702*z));
 return {status:'UNCALIBRATED_TOTALS_PROJECTION',direction:under>=.5?'UNDER':'OVER',
   estimatedUnderProbability:round(under,4),estimatedOverProbability:round(1-under,4),
   projectedTotal:round(projected,2),totalLine:line,remainingSeconds:remaining,
   factors,eligibleForAutomation:false,probabilityCalibrated:false,
   note:'A scoring-pace scenario, not a verified win probability. No automatic bet allowed.'};
}
export function rankStrategies(rows,{max=10}={}){
 const candidates=(Array.isArray(rows)?rows:[]).filter(x=>
   x?.allowed===true&&finite(num(x.expectedNetDollars))&&num(x.expectedNetDollars)>0&&
   finite(num(x.estimatedMaxDebitDollars))&&num(x.estimatedMaxDebitDollars)>0&&
   ((finite(num(x.modeledLossFrequency))&&num(x.modeledLossFrequency)<=.30)||
     (x.strategy==='TOTAL_ALREADY_OVER'&&x.conditionalOutcomeVerified===true&&
       x.modeledLossFrequency==null)));
 const sorted=candidates.map(x=>({...x,
   riskAdjustedScore:round(num(x.expectedNetDollars)/num(x.estimatedMaxDebitDollars),5)}))
   .sort((a,b)=>b.riskAdjustedScore-a.riskAdjustedScore||
     b.expectedNetDollars-a.expectedNetDollars);
 const picked=[],seen=new Set();
 for(const row of sorted){
   const key=String(row.eventKey||row.ticker||row.marketTicker||row.id||'');
   if(!key||seen.has(key))continue;
   seen.add(key);picked.push(row);
   if(picked.length>=max)break;
 }
 return picked;
}
export function adaptiveExitThresholds({volatilityPct=0,confidence=.5}={}){
 const v=Math.max(0,Math.min(25,finite(num(volatilityPct))?num(volatilityPct):0));
 const c=Math.max(0,Math.min(1,finite(num(confidence))?num(confidence):.5));
 return {stopLossPercent:round(Math.max(6,Math.min(15,12-(c-.5)*4)),2),
   takeProfitPercent:round(Math.min(45,15+v*.5),2),
   trailingPercent:round(Math.min(22,6+v*.65),2)};
}

export function bidVolatilityPct(history){
 const rows=(Array.isArray(history)?history:[]).map(x=>({
   at:Date.parse(x.observedAt||x.observed_at||''),bid:num(x.bid)}))
   .filter(x=>finite(x.at)&&finite(x.bid)&&x.bid>0&&x.bid<1)
   .sort((a,b)=>a.at-b.at).slice(-30);
 if(rows.length<5)return null;
 const recent=[];
 for(let i=1;i<rows.length;i++){
  if(rows[i].at===rows[i-1].at)continue;
  recent.push(Math.log(rows[i].bid/rows[i-1].bid));
 }
 if(recent.length<4)return null;
 const mean=recent.reduce((a,b)=>a+b,0)/recent.length;
 const sd=Math.sqrt(recent.reduce((a,b)=>a+(b-mean)**2,0)/recent.length);
 return round(Math.min(25,sd*100),4);
}
