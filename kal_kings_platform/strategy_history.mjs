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

export async function resolveForecasts(sql,fetchMarket){
 const pending=await sql(`SELECT market_ticker FROM kal_kings_strategy_forecasts
   WHERE won IS NULL AND recorded_at<now()-interval '30 minutes'
   AND (last_checked_at IS NULL OR last_checked_at<now()-interval '15 minutes')
   ORDER BY recorded_at ASC LIMIT 8`);
 let resolved=0;
 for(const x of pending){
  let market=null;
  try{market=await fetchMarket(x.market_ticker)}catch{}
  if(['yes','no'].includes(market?.result)&&['settled','finalized'].includes(market.status)){
   await sql(`UPDATE kal_kings_strategy_forecasts SET won=$2::boolean,
     settlement_result=$3,settled_at=now(),last_checked_at=now()
     WHERE market_ticker=$1 AND won IS NULL`,
    [x.market_ticker,market.result==='yes',market.result]);
   resolved++;
  }else{
   await sql(`UPDATE kal_kings_strategy_forecasts SET last_checked_at=now()
     WHERE market_ticker=$1 AND won IS NULL`,[x.market_ticker]);
  }
 }
 return resolved;
}
