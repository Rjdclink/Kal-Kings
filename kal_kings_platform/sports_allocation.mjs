import {seeded} from './engine.mjs';

const specs=Object.freeze({
 NFL:{periods:[4],maxClock:600,minLead:14,leadSpan:21,scoreSigma:3.0},
 CFB:{periods:[4],maxClock:600,minLead:14,leadSpan:21,scoreSigma:3.0},
 NBA:{periods:[4],maxClock:360,minLead:12,leadSpan:22,scoreSigma:2.5},
 WNBA:{periods:[4],maxClock:300,minLead:10,leadSpan:18,scoreSigma:2.0},
 CBB:{periods:[2],maxClock:360,minLead:12,leadSpan:22,scoreSigma:2.5},
 NHL:{periods:[3],maxClock:600,minLead:2,leadSpan:3,scoreSigma:.35},
 EPL:{periods:[2],maxClock:900,minLead:2,leadSpan:3,scoreSigma:.4},
 MLS:{periods:[2],maxClock:900,minLead:2,leadSpan:3,scoreSigma:.4},
 MLB:{periods:[8,9,10,11,12,13,14,15],maxClock:0,minLead:3,leadSpan:4,scoreSigma:1.0}
});
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const good=n=>Number.isFinite(n)&&n>=0;
const normal=rng=>Math.sqrt(-2*Math.log(Math.max(1e-9,rng())))*Math.cos(2*Math.PI*rng());

/** Score/time are the two sports ENTRY screens; this is a monotone tier policy. */
export function sportsLeadTier({sport,period,lead,clockSeconds}={}){
 const rule=specs[sport],left=Number(clockSeconds),difference=Number(lead);
 const periodOk=rule&&(sport==='MLB'?Number(period)>=8:rule.periods.includes(Number(period)));
 if(!rule||!periodOk||!good(left)||left>rule.maxClock||
    !good(difference)||difference<rule.minLead)return {eligible:false,maxAllocationFraction:0,reason:'LEAD_OR_GAME_TIME_NOT_QUALIFIED'};
 const timeStrength=rule.maxClock===0?1:clamp(1-left/rule.maxClock);
 const leadStrength=clamp((difference-rule.minLead)/rule.leadSpan);
 const strength=(timeStrength+leadStrength)/2;
 const maxAllocationFraction=strength>=.75?.50:strength>=.5?.35:strength>=.25?.20:.10;
 return {eligible:true,sport,period,clockSeconds:left,lead:difference,leadStrength,timeStrength,
   strength,maxAllocationFraction,reason:'LATE_GAME_COMMANDING_LEAD'};
}

/** Monte Carlo only reduces/chooses exposure; it never invents entry eligibility. */
export function monteCarloLateGameAllocation({sport,period,lead,clockSeconds,bankroll,seed=17,trials=3000}={}){
 const tier=sportsLeadTier({sport,period,lead,clockSeconds}),cash=Number(bankroll);
 if(!tier.eligible||!good(cash)||cash<=0)return {...tier,eligible:false,allocationFraction:0};
 const rule=specs[sport],rng=seeded(seed);
 const n=Math.max(2500,Math.min(15000,Math.floor(trials)||3000));
 let wins=0;
 for(let i=0;i<n;i++)if(Number(lead)+normal(rng)*rule.scoreSigma*Math.sqrt(clockSeconds/60)>0)wins++;
 const scenarioSurvival=wins/n;
 const allocationFraction=tier.maxAllocationFraction*(.70+.30*scenarioSurvival);
 return {...tier,trials:n,scenarioSurvival,modeledProbabilityIsEntryGate:false,
  allocationFraction,allocatedDollars:cash*allocationFraction};
}

/** FOK liquidity/price uncertainty changes size, not the confirmed score result. */
export function monteCarloOverAllocation({bankroll,price,depth,seed=17,trials=3000}={}){
 const cash=Number(bankroll),ask=Number(price),liquidity=Number(depth);
 if(!good(cash)||cash<=0||!(ask>0&&ask<1)||!good(liquidity)||liquidity<1)
  return {allocationFraction:0,trials:0,modeledProbabilityIsEntryGate:false};
 const rng=seeded(seed),n=Math.max(2500,Math.min(15000,Math.floor(trials)||3000));
 const desiredContracts=Math.floor(.80*cash/ask);
 let viable=0;
 for(let i=0;i<n;i++){
   const possible=Math.floor(liquidity*(.65+.5*rng()));
   if(possible>=desiredContracts)viable++;
 }
 const allocationFraction=.75+.05*viable/n;
 return {allocationFraction,trials:n,modeledProbabilityIsEntryGate:false,
  scenarioLiquiditySuccessRate:viable/n,allocatedDollars:cash*allocationFraction};
}

/** A live scoreboard lead/time qualifies the strategy; Monte Carlo only sizes it.
 * The conditional payout check is NOT a forecast or guaranteed net return.
 */
export function planLateGameOrder({game,market,bankroll,feePerContract,holdings,now=Date.now()}={}){
 const deny=reason=>({allowed:false,reason,strategy:'LATE_GAME_LEAD'});
 const home=Number(game?.homeScore),away=Number(game?.awayScore);
 const leading=Math.abs(home-away);
 if(!Number.isFinite(home)||!Number.isFinite(away)||home<0||away<0) return deny('SCORE_UNVERIFIED');
 const sizing=monteCarloLateGameAllocation({sport:game?.sport,period:game?.period,
   clockSeconds:game?.clockSeconds,lead:leading,bankroll,seed:29});
 if(!sizing.eligible)return deny('LEAD_OR_GAME_TIME_NOT_QUALIFIED');
 const cash=Number(bankroll),px=Number(market?.yesAsk),depth=Number(market?.yesDepth),fee=Number(feePerContract);
 const observedAge=now-Date.parse(market?.observedAt||'');
 if(!['active','open'].includes(market?.status)||!good(observedAge)||observedAge>3000)
  return deny('MARKET_NOT_EXECUTABLE_OR_STALE');
 if(!(px>0&&px<1)||!good(depth)||depth<1||!good(fee)||!good(cash)||cash<=0)
  return deny('PRICE_OR_CASH_UNVERIFIED');
 if(!Array.isArray(holdings))return deny('POSITIONS_UNVERIFIED');
 if(holdings.some(p=>p.ticker===market.ticker&&Number(p.position)!==0))return deny('EXISTING_MARKET_EXPOSURE');
 const unit=px+fee;
 if(!(1-unit>1e-9))return deny('NO_PROFIT_IF_CONTRACT_WINS');
 const budget=Math.min(cash,cash*sizing.allocationFraction);
 const contracts=Math.min(10000,Math.floor(depth),Math.floor(budget/unit));
 if(contracts<1)return deny('INSUFFICIENT_BANKROLL_OR_DEPTH');
 return {allowed:true,strategy:'LATE_GAME_LEAD',reason:'SCORE_AND_CLOCK_ELIGIBLE',
  ticker:market.ticker,side:'yes',contracts,limitPrice:px,feePerContract:fee,
  estimatedFeesDollars:Number((contracts*fee).toFixed(4)),
  estimatedMaxDebitDollars:Number((contracts*unit).toFixed(4)),
  modeledWinProbability:null,modeledLossFrequency:null,modeledProbabilityIsEntryGate:false,
  scenarioSurvival:sizing.scenarioSurvival,allocationFraction:sizing.allocationFraction,
  maximumAllocationFraction:sizing.maxAllocationFraction,
  netIfWinDollars:Number((contracts*(1-unit)).toFixed(4)),
  confidenceBasis:'LEAD_AND_TIME_ONLY',allocationBasis:'MONTE_CARLO_SIZING_ONLY'};
}
