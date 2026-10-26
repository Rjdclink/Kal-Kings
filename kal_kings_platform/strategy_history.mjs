import {walkForwardScore} from './strategy_optimizer.mjs';
export function summarizeActualOutcomes(rows=[]){return walkForwardScore(rows)}
export function eligibleForecast(x){return x?.sourceVerified===true&&x?.marketMatchVerified===true&&!!x?.market?.ticker&&!!x?.modelPlayId&&Number.isFinite(x?.externalWinProbability)&&x.externalWinProbability>0&&x.externalWinProbability<1}
