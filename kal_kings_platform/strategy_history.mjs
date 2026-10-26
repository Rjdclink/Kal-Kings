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

export async function getStrategyPerformance(sql){
 const outcomes=await sql(`SELECT recorded_at AS at,
   model_probability::text AS probability,
   market_probability::text AS "marketProbability",won
   FROM kal_kings_strategy_forecasts WHERE won IS NOT NULL
   ORDER BY recorded_at DESC LIMIT 400`);
 const orders=await sql(`SELECT status,COUNT(*)::int AS n
   FROM kal_kings_directional_orders GROUP BY status`);
 return {...summarizeActualOutcomes(outcomes),
   recordedSettlements:outcomes.length,
   actualOrderStatuses:Object.fromEntries(orders.map(x=>[x.status,Number(x.n)])),
   modeledLossCeiling:.15};
}
export async function getDirectionalOrders(sql){
 const rows=await sql(`SELECT ticker,strategy,side,status,contracts::text AS contracts,
   filled_count::text AS filled_count,entry_price::text AS entry_price,
   modeled_probability::text AS modeled_probability,created_at,updated_at
   FROM kal_kings_directional_orders ORDER BY created_at DESC LIMIT 15`);
 return rows.map(x=>({...x,contracts:Number(x.contracts),
   filled:Number(x.filled_count),price:Number(x.entry_price),
   modeledProbability:Number(x.modeled_probability)}));
}
