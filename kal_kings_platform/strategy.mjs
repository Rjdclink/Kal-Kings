/** Kal Kings sports sizing and execution-conditional Monte Carlo.
 * Forecasts are supplied externally; confidence is not evidence of forecast calibration.
 * These functions do not submit orders or mutate account balances.
 */
import {americanToDecimal, estimatedKalshiFee, seeded, cash, validPrice} from './engine.mjs';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const cents=x=>Math.round((x+Number.EPSILON)*100)/100;
const quantile=(sorted,p)=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];

export function riskPolicy(bankroll){
  const b=Number(bankroll);
  if(!finite(b)||b<0)throw RangeError('Invalid bankroll');
  // Percentage increases with available bankroll. No fixed-dollar ceiling.
  const riskPercent=b<100?0.75:b<500?1:b<2500?1.5:b<10000?2:2.5;
  const ordinaryRiskBudget=Math.min(b,b*riskPercent/100);
  return {bankrollDollars:cents(b),riskPercent,
    tailLimitDollars:ordinaryRiskBudget,hardLossLimitDollars:ordinaryRiskBudget,
    minimumExecutableExceptionEligible:b>0,
    annualizedReturnTarget:null,
    note:'The percentage is a normal allocation budget, not a fixed-dollar ceiling. A single affordable minimum-lot order may exceed that budget only if the trade has verified positive edge and passes all other checks; this may risk a substantial fraction of tiny balances.'};
}

/** One minimum unit is considered only AFTER market/edge/fee/freshness checks.
 * The exception never creates an order, never exceeds free cash, and is not
 * an exception to matching settlements or independently verified probability.
 */
export function adaptiveCapitalLimit(policy,minUnitCost){
  const cost=Number(minUnitCost),available=Number(policy?.bankrollDollars);
  const base=Number(policy?.hardLossLimitDollars);
  if(!finite(cost)||cost<=0||!finite(available)||available<=0||!finite(base))
    return {budget:0,minimumTradeExceptionApplied:false};
  if(cost>available+1e-9)return {budget:base,minimumTradeExceptionApplied:false};
  return {budget:Math.max(base,cost),minimumTradeExceptionApplied:cost>base+1e-9};
}

export function impliedTwoWay(outcomes,selection){
  if(!Array.isArray(outcomes)||outcomes.length!==2||outcomes[0]?.selection===outcomes[1]?.selection)return null;
  try{
    const a=outcomes.map(o=>({selection:o.selection,p:1/americanToDecimal(o.american)}));
    if(a.some(o=>!finite(o.p)||o.p<=0||o.p>=1))return null;
    const chosen=a.find(o=>o.selection===selection);if(!chosen)return null;
    return chosen.p/(a[0].p+a[1].p);
  }catch{return null;}
}

export function recommendedDirectional({bankroll,price,probability,depth,sourceAgeMs,feePerContract=null}){
  const policy=riskPolicy(bankroll);
  if(!validPrice(price)||!finite(Number(probability))||probability<=0||probability>=1)return {accepted:false,reason:'INVALID_MARKET',policy};
  if(!finite(Number(sourceAgeMs))||sourceAgeMs<0||sourceAgeMs>90000)return {accepted:false,reason:'STALE_QUOTE',policy};
  if(!finite(Number(depth))||depth<1)return {accepted:false,reason:'INSUFFICIENT_LIQUIDITY',policy};
  const p=Number(price),fair=Number(probability);
  const fee=feePerContract===null?estimatedKalshiFee(1,p):Number(feePerContract);
  if(!finite(fee)||fee<0)return {accepted:false,reason:'INVALID_FEE',policy};
  const edge=fair-p-fee;
  if(edge<=1e-9)return {accepted:false,reason:'NO_POSITIVE_EDGE',edgePerContract:cents(edge),policy};
  // Confidence and edge both affect allocation, without overruling worst-case loss.
  const confidenceWeight=Math.max(0.12,Math.min(1,(fair-.5)/.48));
  const edgeWeight=Math.max(0.25,Math.min(1,edge/.04));
  const lossPerContract=p+fee;
  const adaptive=adaptiveCapitalLimit(policy,lossPerContract);
  // Model-weighted sizing for normal bankrolls; for a minimum-lot exception
  // use exactly one unit, never the entire balance by default.
  const weighted=policy.hardLossLimitDollars*confidenceWeight*edgeWeight;
  const allocationBudget=Math.max(weighted,adaptive.minimumTradeExceptionApplied?lossPerContract:0);
  const contracts=Math.max(0,Math.min(Math.floor(depth),Math.floor(adaptive.budget/lossPerContract),Math.floor(allocationBudget/lossPerContract)));
  if(contracts<1)return {accepted:false,reason:'INSUFFICIENT_RISK_BUDGET',policy};
  const spend=cents(contracts*lossPerContract);
  if(spend>adaptive.budget+1e-8||spend>bankroll+1e-8)return {accepted:false,reason:'INSUFFICIENT_RISK_BUDGET',policy};
  return {accepted:true,reason:'CANDIDATE',contracts,stakeDollars:spend,
    price:p,modelProbability:fair,marketImpliedProbability:p,
    edgePercentagePoints:Math.round(edge*10000)/100,
    expectedNetProfitDollars:Math.round(contracts*edge*10000)/10000,maximumLossDollars:spend,
    minimumTradeExceptionApplied:adaptive.minimumTradeExceptionApplied,
    effectiveRiskPercent:Math.round(100000*spend/bankroll)/1000,
    confidenceWeight:Math.round(confidenceWeight*1000)/1000,
    policy,note:'Conditional on an independently validated probability estimate. Minimum-lot exception may concentrate small bankrolls and is not a profit guarantee.'};
}

export function simulateDirectional({contracts,price,probability,fillProbability=1,trials=5000,seed=451,feePerContract=0}){
  if(!Number.isInteger(contracts)||contracts<1||!validPrice(price)||!finite(probability)||probability<0||probability>1||!finite(fillProbability)||fillProbability<0||fillProbability>1||!Number.isInteger(trials)||trials<100||trials>100000||!finite(feePerContract)||feePerContract<0)throw RangeError('Invalid simulation assumptions');
  const rng=seeded(seed),executed=[],n=contracts;
  for(let i=0;i<trials;i++){
    if(rng()>=fillProbability)continue; // No trade => no P/L, no win, no loss.
    const wins=rng()<probability;
    executed.push((wins?n:0)-n*(price+feePerContract));
  }
  executed.sort((a,b)=>a-b);
  const count=executed.length,nonfills=trials-count;
  if(!count)return {mode:'SIMULATION_ONLY',trials,executedTrials:0,noFillTrials:nonfills,executionRate:0,
    expectedProfit:null,lossFrequency:null,p05:null,meanWorst5Percent:null,
    note:'No fills simulated. Non-execution is not treated as a profitable or losing trade.'};
  const worst=Math.max(1,Math.ceil(.05*count));
  return {mode:'SIMULATION_ONLY',trials,executedTrials:count,noFillTrials:nonfills,executionRate:cents(count/trials*100),
    expectedProfit:cents(executed.reduce((a,b)=>a+b,0)/count),
    lossFrequency:cents(executed.filter(x=>x<0).length/count*100),
    p05:cents(quantile(executed,.05)),p95:cents(quantile(executed,.95)),
    meanWorst5Percent:cents(executed.slice(0,worst).reduce((a,b)=>a+b,0)/worst),
    note:'Execution-conditional Monte Carlo. Non-fills excluded from performance; probability and liquidity require independent calibration.'};
}

export function chooseHedge({kalshiAsk,dkOdds,kalshiBalance,dkBalance,availableDepth,bankroll}){
  if(!validPrice(kalshiAsk))return null;
  let decimal;
  try{decimal=americanToDecimal(dkOdds)}catch{return null}
  const policy=riskPolicy(bankroll??(Number(kalshiBalance)+Number(dkBalance)));
  const kb=Number(kalshiBalance),db=Number(dkBalance),depth=Number(availableDepth);
  if(!finite(kb)||!finite(db)||!finite(depth)||kb<0||db<0||depth<1)return null;
  const max=Math.min(1000,Math.floor(depth));let best=null;
  for(let count=1;count<=max;count++){
    const fee=estimatedKalshiFee(count,kalshiAsk);
    const kCost=cents(count*kalshiAsk+fee);
    const dkStake=cents(count/decimal);
    const kBudget=adaptiveCapitalLimit({...policy,bankrollDollars:kb},estimatedKalshiFee(1,kalshiAsk)+kalshiAsk);
    const dkBudget=adaptiveCapitalLimit({...policy,bankrollDollars:db},cash(1/decimal));
    if(kCost>kb||dkStake>db||kCost>kBudget.budget||dkStake>dkBudget.budget)break;
    const total=kCost+dkStake;
    const profit=cents(Math.min(count,dkStake*decimal)-total);
    if(profit>0&&(!best||profit>best.minimumNetProfit))best={kalshiContracts:count,kalshiCostDollars:kCost,dkStakeDollars:dkStake,
      kalshiFeeDollars:fee,minimumNetProfit:profit,capitalRequired:cents(total),riskPolicy:policy,minimumTradeExceptionApplied:kBudget.minimumTradeExceptionApplied||dkBudget.minimumTradeExceptionApplied,
      note:'Indicative only; both legs and identical settlement rules must be verified.'};
  }
  return best;
}
