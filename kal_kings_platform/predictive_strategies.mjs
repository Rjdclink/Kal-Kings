/**
 * Kal Kings conditional strategy filters.
 *
 * These are signal evaluators, not predictive or settlement-calibrated models.
 * Three exchanges repeating the same market move are NOT three independent
 * forecasts and may never by themselves authorize a real-money order.
 * Automatic entry requires a separately validated forward-looking model.
 */
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const number=v=>v===null||v===undefined||v===''?NaN:Number(v);
const round=(n,places=4)=>Number(n.toFixed(places));
const safeAge=(stamp,now)=>now-Date.parse(stamp||'');
const denied=(reason,extra={})=>({allowed:false,reason,...extra});
const sportsAge=(x,now)=>safeAge(x.updatedAt,now);
export const CRYPTO_SOURCE_NAMES=Object.freeze(['coinbase','kraken','bitstamp','gemini','okx','kucoin','bitfinex']);
const sourceSet=new Set(CRYPTO_SOURCE_NAMES);

/** Direction agreement among THREE separate, fresh USD spot venues.
 * No venue may be counted twice, and source quotes must agree on level.
 */
export function cryptoConsensus(rows,{symbol,now=Date.now(),minSources=5,minReturnPct=.08,maxAgeMs=30_000,maxSpreadPct=1}={}){
 const seen=new Set(),valid=[];
 for(const row of Array.isArray(rows)?rows:[]){
   const source=String(row?.source||'').toLowerCase().trim();
   const asset=String(row?.symbol||'').toUpperCase().trim();
   const age=safeAge(row?.observedAt,now),open=number(row?.start),close=number(row?.last);
   if(!sourceSet.has(source)||seen.has(source)||asset!==symbol||!finite(age)||age<0||age>maxAgeMs||
       !finite(open)||!finite(close)||open<=0||close<=0)continue;
   seen.add(source);
   valid.push({source,open,close,returnPct:round((close/open-1)*100,5)});
 }
 const base={symbol,sources:valid.length,direction:'UNKNOWN',agreeingSources:0,agreement:0,
   allocationFraction:0,totalSupportedSources:7,
   action:'SIGNAL_ONLY',observations:valid,reason:'INSUFFICIENT_INDEPENDENT_SOURCES'};
 if(valid.length<minSources)return base;
 const sorted=valid.map(x=>x.close).sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
 const spreadPct=(Math.max(...sorted)-Math.min(...sorted))/median*100;
 if(spreadPct>maxSpreadPct)return {...base,spreadPct:round(spreadPct),reason:'PRICE_DISAGREEMENT'};
 const up=valid.filter(x=>x.returnPct>=minReturnPct).length;
 const down=valid.filter(x=>x.returnPct<=-minReturnPct).length;
 const max=Math.max(up,down),direction=up>down?'UP':down>up?'DOWN':'UNKNOWN';
 if(max<minSources||direction==='UNKNOWN')
   return {...base,spreadPct:round(spreadPct),agreeingSources:max,agreement:round(max/valid.length),reason:'NO_DIRECTIONAL_CONSENSUS'};
 return {...base,direction,agreeingSources:max,agreement:round(max/valid.length),
   allocationFraction:max>=7?.4:max===6?.3:max===5?.2:0,
   spreadPct:round(spreadPct),medianPrice:round(median,8),reason:'CONSENSUS_OBSERVED',
   note:'Aligned historical spot momentum; not an estimated chance of future profit.'};
}

/** Real trades may only use independently validated, matching Kalshi-specific
 * outcome probabilities; market votes or past spot momentum are insufficient.
 */
export function planDirectionalTrade({consensus,market,bankroll,feePerContract,model,now=Date.now(),lossFrequencyLimit=.15}={}){
 if(!consensus||!['UP','DOWN'].includes(consensus.direction)||consensus.agreeingSources<5||
   !(consensus.allocationFraction>=.2))return denied('NO_INDEPENDENT_CONSENSUS');
 const asset=String(consensus.symbol||'').toUpperCase(),series='KX'+asset+'15M';
 if(!['BTC','ETH','SOL','XRP','DOGE','ADA'].includes(asset)||market?.seriesTicker!==series||
   !String(market?.ticker||'').startsWith(series+'-')||!['open','active'].includes(market.status))
   return denied('UNVERIFIED_MARKET_MAPPING');
 const rules=String(market.rulesPrimary||'');
 if(!/CF Benchmarks/i.test(rules)||!/average/i.test(rules)||!/(before|prior)/i.test(rules)||
   !/(at least|greater than or equal|higher than)/i.test(rules))
   return denied('UNVERIFIED_SETTLEMENT_RULES');
 const age=safeAge(market.observedAt,now),until=Date.parse(market.closeTime||'')-now;
 if(!finite(age)||age<0||age>3000||!finite(until)||until<10000||until>900000)
   return denied('STALE_OR_INVALID_TRADING_WINDOW');
 const side=consensus.direction==='UP'?'yes':'no',ask=number(market[side+'Ask']),
   depth=number(market[side+'Depth']),cash=number(bankroll),fee=number(feePerContract);
 if(!finite(ask)||ask<=0||ask>=1||!finite(depth)||depth<1||!finite(cash)||cash<=0||
    !finite(fee)||fee<0)return denied('INVALID_EXECUTABLE_PRICE_OR_CASH');
 if(!model||!(model.validated===true||model.status==='ESTIMATED')||
    model.symbol!==asset||model.direction!==consensus.direction||
    model.horizonMinutes!==15||model.settlementBasis!=='CF_BENCHMARKS_RTI'||
    !finite(safeAge(model.observedAt||model.validatedAt,now))||
    safeAge(model.observedAt||model.validatedAt,now)<0||
    safeAge(model.observedAt||model.validatedAt,now)>30000||
    !finite(number(model.probability)))
   return denied('INDEPENDENT_PROBABILITY_NOT_VALIDATED',{consensus});
 const p=number(model.probability),price=ask+fee,loss=1-p,edge=p-price;
 if(p<=0||p>=1||loss>lossFrequencyLimit+1e-9)
   return denied('MODELED_LOSS_EXCEEDS_LIMIT',{modeledLossFrequency:round(loss)});
 if(edge<=.02)return denied('NO_VERIFIED_POSITIVE_EDGE',{expectedEdge:round(edge)});
 // Preserve small-bankroll protection. A single minimum unit can exceptionally
 // exceed the ordinary 0.75% bankroll limit, but never 25% of free cash.
 const ordinary=cash*consensus.allocationFraction,maxMinimum=ordinary,unit=price;
 if(unit>cash||unit>maxMinimum)return denied('INSUFFICIENT_RISK_BUDGET');
 const count=Math.max(1,Math.min(50,Math.floor(depth),Math.floor(ordinary/unit)||1));
 if(unit*count>cash+1e-8||unit*count>Math.max(ordinary,unit)+1e-8)
   return denied('INSUFFICIENT_RISK_BUDGET');
 return {allowed:true,reason:'VALIDATED_DIRECTIONAL_ENTRY',strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',
   ticker:market.ticker,side,contracts:count,price:ask,feePerContract:fee,
   estimatedMaxDebitDollars:round(count*(price+fee),4),modeledWinProbability:round(p),
   modeledLossFrequency:round(loss),expectedNetDollars:round(count*edge,4),
   sources:consensus.observations.map(x=>x.source),confidenceBasis:'INDEPENDENT_VALIDATED_MODEL',
   note:'Estimated edge is not guaranteed profit. CF Benchmarks settlement may differ from spot.'};
}

/** A commanding late lead is a screening condition, not a guaranteed profit.
 * All scoreboard inputs must be live, current and independently identified.
 */
export function assessLateGame({sport,home,away,homeScore,awayScore,period,clockSeconds,state,updatedAt,now=Date.now()}={}){
 const base={strategy:'LATE_GAME_LEAD',action:'REVIEW_ONLY',eligibleForAutomation:false,
   direction:null,reason:'NOT_A_VERIFIED_LATE_GAME'};
 const age=sportsAge({updatedAt},now);
 if(state!=='in'||!finite(age)||age<0||age>30_000||!home||!away||!finite(number(homeScore))||
   !finite(number(awayScore))||!finite(number(period))||!finite(number(clockSeconds)))
   return {...base,reason:'STALE_OR_INVALID_LIVE_SCORE'};
 const lead=Math.abs(number(homeScore)-number(awayScore)),leader=Number(homeScore)>Number(awayScore)?home:away;
 const rules={NFL:{period:4,maxClock:600,minLead:14},NBA:{period:4,maxClock:360,minLead:12},
   NHL:{period:3,maxClock:480,minLead:2}};
 const rule=rules[String(sport||'').toUpperCase()];
 if(!rule||period!==rule.period||clockSeconds>rule.maxClock||lead<rule.minLead)
   return base;
 return {...base,direction:leader,lead,period,clockSeconds,reason:'COMMANDING_LATE_LEAD',
   factors:['Verified live score','Time remaining','Lead margin'],
   note:'Strong lead does not establish favorable odds; independent live probability and fresh Kalshi executable price are required before trading.'};
}

/** Totals pre-filter. Adjust for verified wind, precipitation and key injuries.
 * Unknown factors remain unknown; there is no hard-coded fictitious win chance.
 */
export function assessTotals({sport,totalLine,homeScore,awayScore,period,clockSeconds,state,updatedAt,
 weather={},injuries=[],now=Date.now()}={}){
 const base={strategy:'OVER_UNDER_CONTEXT',direction:null,eligibleForAutomation:false,
   action:'REVIEW_ONLY',factors:[],reason:'INSUFFICIENT_CONTEXT'};
 const age=safeAge(updatedAt,now),line=number(totalLine);
 if(!['NFL','NBA','NHL'].includes(String(sport||'').toUpperCase())||
    !finite(age)||age<0||age>90_000||!['pre','in'].includes(state)||!finite(line)||line<=0||
    !finite(number(homeScore))||!finite(number(awayScore)))
   return base;
 let tilt=0;const factors=[];
 if(String(sport).toUpperCase()==='NFL'&&weather?.indoor!==true){
   const wind=number(weather?.windMph),gust=number(weather?.gustMph);
   if(finite(wind)&&wind>=18){tilt-=2;factors.push('Strong verified wind');}
   else if(finite(gust)&&gust>=30){tilt-=1;factors.push('Strong verified wind gusts');}
   const rain=number(weather?.precipitationMm);
   if(finite(rain)&&rain>=4){tilt-=1;factors.push('Significant precipitation');}
 }
 for(const injury of Array.isArray(injuries)?injuries:[]){
   const status=String(injury?.status||'').toLowerCase(),role=String(injury?.role||'').toUpperCase();
   if(['out','inactive'].includes(status)&&['QB','WR1','RB1','PG','C'].includes(role)){
     tilt-=1;factors.push('Confirmed key offensive player unavailable');}
 }
 // Live totals in excess of the listed threshold guarantee OVER upon normal
 // settlement only after matching the exact official scoring rules.
 const score=number(homeScore)+number(awayScore);
 if(state==='in'&&score>line){factors.push('Live score already exceeds the displayed total');return {...base,direction:'OVER',factors,reason:'LIVE_SCORE_OVER_LINE'};}
 if(tilt<=-2)return {...base,direction:'UNDER',factors,reason:'CONTEXT_FAVORS_UNDER'};
 return {...base,factors,reason:'NO_SIGNIFICANT_TOTALS_BIAS'};
}
