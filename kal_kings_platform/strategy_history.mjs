import {walkForwardScore} from './strategy_optimizer.mjs';
export function summarizeActualOutcomes(rows=[]){return walkForwardScore(rows)}
export function eligibleForecast(x){return x?.sourceVerified===true&&x?.marketMatchVerified===true&&!!x?.market?.ticker&&!!x?.modelPlayId&&Number.isFinite(x?.externalWinProbability)&&x.externalWinProbability>0&&x.externalWinProbability<1}

export async function recordForecasts(sql,sports=[]){
 let count=0;
 for(const x of sports){
  if(!eligibleForecast(x)||!(x.market.yesAsk>0&&x.market.yesAsk<1))continue;
  await sql(`INSERT INTO kal_kings_strategy_forecasts
    (market_ticker,strategy,event_key,selection_side,model_source,
    model_probability,market_probability)
    VALUES($1,'LATE_GAME_LEAD',$2,'yes','ESPN_LIVE_MODEL',$3::numeric,$4::numeric)
    ON CONFLICT(market_ticker) DO NOTHING`,
    [x.market.ticker,String(x.eventKey||x.id),String(x.externalWinProbability),String(x.market.yesAsk)]);
  count++;
 }
 return count;
}
