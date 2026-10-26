/** Kal Kings — Neon-hosted read-first sports/crypto market command center.
 *  Main branch and research_engine are not modified by this package.
 *  Authenticated routes require KALKINGS_ADMIN_TOKEN; no keys in front end.
 */
import {readFileSync} from 'node:fs';
import {createPrivateKey, sign, timingSafeEqual, createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, constants} from 'node:crypto';
import {evaluatePair,monteCarlo,rankCandidates,quoteAge,validPrice,americanToDecimal,estimatedKalshiFee,estimatedKalshiBuyDebit,cash} from './engine.mjs';
import {riskPolicy,chooseHedge} from './strategy.mjs';
import {favoriteWatchlist,directionalCandidates} from './sports.mjs';
import {collectKalshiSports,collectPolymarketSports,topSports,cryptoUniverse,discoverQuotedGaps} from './feeds.mjs';
import {activeAgent} from './agents.mjs';
import {parseTradingViewAlert,mergeCryptoAlerts,priceTrendFromCandles} from './tradingview.mjs';
import {sharpFeedOdds} from './sharp.mjs';
import {buildKalshiHedgePlan,kalshiV2Order} from './orders.mjs';
import {buildTradeBoard,executionSummary,bankrollTradeStatus} from './trade_board.mjs';
import {findKalshiSoloCandidates,summarizeSoloOrders} from './kalshi_solo.mjs';
import {makeSoloRunner,isNeonSoloTrigger,activeScanSlot} from './solo_runner.mjs';
import {makeKalshiLifecycle} from './kalshi_lifecycle.mjs';
import {cashAvailableForReinvestment} from './kalshi_manager.mjs';
import {normalizeKalshiBook,monteCarloExitDecision} from './quant.mjs';
import {assessLiveKalshiEntry,historyForExit,summarizeQuantState} from './quant_runtime.mjs';
import {selectHistorySamples} from './history_sampler.mjs';
import {fetchCryptoSignals,fetchSportsSignals} from './predictive_feeds.mjs';
import {fetchFinalCryptoConsensus} from './crypto_final_consensus.mjs';
import {makeDirectionalRunner} from './directional_runner.mjs';
import {rankCryptoCandidates} from './crypto_candidate.mjs';
import {makeManualExecutor} from './manual_execution.mjs';
import {makeDirectionalLifecycle} from './directional_lifecycle.mjs';
import {rankStrategies} from './strategy_optimizer.mjs';
import {verifyExceededTotal} from './total_strategy.mjs';
import {makeUniverseScanner} from './universe_service.mjs';
import {recordForecasts,resolveForecasts,getStrategyPerformance,getDirectionalOrders} from './strategy_history.mjs';
import {planOneTimeMicroOrder,interpretMicroReceipt} from './live_trade_test.mjs';

const HTML=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
const KALSHI='https://external-api.kalshi.com';
const KALSHI_PUBLIC='https://api.elections.kalshi.com';
const POLY='https://gateway.polymarket.us';
const SPORTS=['americanfootball_nfl','basketball_nba','baseball_mlb','icehockey_nhl'];
const KALSHI_SPORTS_SERIES=['KXNFLGAME','KXNBAGAME','KXMLBGAME','KXNHLGAME','KXCFBGAME','KXCBBGAME','KXEPLGAME','KXMLSGAME'];
const TTL={trends:90000,kalshi:3000,polymarket:8000,draftkings:Math.max(60000,Number(process.env.ODDS_POLL_MS)||60000),account:6000,crypto:12000,polyaccount:30000};
const LIMIT=200;
const cache=new Map();
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const safeNumber=(x)=>Number.isFinite(Number(x))?Number(x):null;
const str=(x,max=300)=>String(x??'').trim().slice(0,max);
const displayNumber=(x)=>x==null?null:Number(x);
const iso=()=>new Date().toISOString();
const allowEnvToken=req=>{
  const expected=process.env.KALKINGS_ADMIN_TOKEN||'';
  const value=req.headers.get('x-kal-kings-admin')||'';
  const actual=Buffer.from(value), target=Buffer.from(expected);
  return expected.length>=32&&actual.length===target.length&&timingSafeEqual(actual,target);
};
function error(status,code){return reply({error:code},status);}
async function external(url,headers={}){
  const r=await fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw Error(`Provider HTTP ${r.status}`);
  const text=await r.text();
  if(text.length>6000000)throw Error('Provider response too large');
  return JSON.parse(text);
}
async function memo(key,ttl,loader){
  const now=Date.now();const item=cache.get(key);
  if(item&&now-item.time<ttl&&item.data!==undefined)return item.data;
  if(item?.promise)return item.promise;
  const pending=Promise.resolve().then(loader).then(data=>{
    cache.set(key,{time:Date.now(),data,error:null});return data;
  }).catch(ex=>{
    // Error does not silently turn an old cached price into a current one.
    cache.set(key,{time:Date.now(),data:null,error:String(ex.message||'Unavailable').slice(0,120)});
    throw ex;
  });
  cache.set(key,{time:now,promise:pending,data:undefined});return pending;
}
const cachedStatus=key=>({lastFetch:cache.get(key)?.time?new Date(cache.get(key).time).toISOString():null,error:cache.get(key)?.error||null});
const requiredEnv=()=>({
  adminConfigured:Boolean(process.env.KALKINGS_ADMIN_TOKEN?.length>=32),
  kalshiConfigured:Boolean(process.env.KALSHI_API_KEY_ID&&process.env.KALSHI_PRIVATE_KEY),
  polymarketConfigured:Boolean(process.env.POLYMARKET_KEY_ID&&process.env.POLYMARKET_SECRET_KEY),
  oddsFeedConfigured:true, // The independent deployed SharpAPI odds relay is available without another dashboard secret.
});

export function kalshiHeaders(path,method='GET',ts=Date.now(),env=process.env){
  if(!env.KALSHI_API_KEY_ID||!env.KALSHI_PRIVATE_KEY)throw Error('Kalshi credentials absent');
  const key=createPrivateKey(env.KALSHI_PRIVATE_KEY.replace(/\\n/g,'\n'));
  const message=Buffer.from(`${ts}${method}${path.split('?')[0]}`);
  let signed;
  if(key.asymmetricKeyType==='ed25519')signed=sign(null,message,key);
  else if(key.asymmetricKeyType==='rsa')signed=sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32});
  else throw Error('Unsupported Kalshi key algorithm');
  return {'KALSHI-ACCESS-KEY':env.KALSHI_API_KEY_ID,
   'KALSHI-ACCESS-TIMESTAMP':String(ts),
   'KALSHI-ACCESS-SIGNATURE':signed.toString('base64')};
}
async function kalshiPrivate(path){
  return external(KALSHI+path,kalshiHeaders(path));
}
export async function publicKalshi(){
  // Sample multiple official sports series, rather than repeatedly displaying the
  // same NFL/NBA markets. A filtered sports event may have no category field.
  const fetchedAt=iso();
  const pages=await Promise.allSettled(KALSHI_SPORTS_SERIES.map(async series=>({
    series,data:await external(`${KALSHI_PUBLIC}/trade-api/v2/events?series_ticker=${encodeURIComponent(series)}&limit=200&status=open&with_nested_markets=true`),
  })));
  if(pages.every(item=>item.status==='rejected'))throw Error('Kalshi sports markets unavailable');
  return collectKalshiSports(pages.filter(item=>item.status==='fulfilled').map(item=>item.value),fetchedAt,LIMIT);
}
export async function publicPolymarket(){
  // Official public U.S. exchange gateway, never the international Polymarket CLOB.
  // Page through additional markets so sports are not crowded out by the first page.
  const fetchedAt=iso();
  const pages=await Promise.allSettled([0,200,400].map(offset=>external(
    `${POLY}/v1/markets?limit=200&offset=${offset}&active=true&closed=false&sportsMarketTypes=SPORTS_MARKET_TYPE_MONEYLINE`
  )));
  if(pages.every(item=>item.status==='rejected'))throw Error('Polymarket US sports markets unavailable');
  return collectPolymarketSports(pages.filter(item=>item.status==='fulfilled').map(item=>item.value),fetchedAt,LIMIT);
}
async function cryptoTrends(){
  const r=await Promise.allSettled(cryptoUniverse.map(async product=>{
    const result=await external(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=3600`,{'user-agent':'KalKings/1.0'});
    if(!Array.isArray(result))throw Error('No completed candle data');
    const completed=result.filter(row=>Array.isArray(row)&&Number(row[0])*1000<Date.now()-3600000)
      .sort((a,b)=>Number(a[0])-Number(b[0])).slice(-80)
      .map(row=>({close:Number(row[4])}));
    return {symbol:product.replace('-','/'),...priceTrendFromCandles(completed)};
  }));
  return r.flatMap(x=>x.status==='fulfilled'?[x.value]:[]);
}
async function cryptoSpot(){
  const all=await Promise.allSettled(cryptoUniverse.map(product=>external(
    `https://api.exchange.coinbase.com/products/${product}/ticker`,{'user-agent':'KalKings/1.0'}
  )));
  return all.flatMap((entry,i)=>{
    if(entry.status!=='fulfilled'||!Number.isFinite(Number(entry.value.price))||Number(entry.value.price)<=0)return [];
    return [{symbol:cryptoUniverse[i].replace('-','/'),price:Number(entry.value.price),
      updatedAt:entry.value.time||null,observedAt:iso(),source:'Coinbase Exchange (spot reference)'}];
  });
}
export function polymarketHeaders(path,method='GET',ts=Date.now(),env=process.env){
 const keyId=env.POLYMARKET_KEY_ID, secret=env.POLYMARKET_SECRET_KEY;
 if(!keyId||!secret)throw Error('Polymarket US credentials absent');
 const raw=Buffer.from(secret.trim(),'base64');if(raw.length!==32&&raw.length!==64)throw Error('Invalid Polymarket US secret');
 const prefix=Buffer.from('302e020100300506032b657004220420','hex');
 const key=createPrivateKey({key:Buffer.concat([prefix,raw.subarray(0,32)]),format:'der',type:'pkcs8'});
 return {'X-PM-Access-Key':keyId,'X-PM-Timestamp':String(ts),
   'X-PM-Signature':sign(null,Buffer.from(`${ts}${method}${path.split('?')[0]}`),key).toString('base64')};
}
async function polyAccountCheck(){
 if(!requiredEnv().polymarketConfigured)return {status:'NOT_CONFIGURED'};
 try{
  const res=await external('https://api.polymarket.us/v1/account/balances',polymarketHeaders('/v1/account/balances'));
  if(!Array.isArray(res.balances))return {status:'INVALID_RESPONSE'};
  return {status:'VERIFIED'};
 }catch{return {status:'UNAVAILABLE'};}
}
export async function draftKingsOdds(key){
  if(!key)throw Error('Odds provider key missing');
  const results=await Promise.allSettled(SPORTS.map(s=>{
    const u=new URL(`https://api.the-odds-api.com/v4/sports/${s}/odds/`);
    u.search=new URLSearchParams({apiKey:key,regions:'us',markets:'h2h',bookmakers:'draftkings',oddsFormat:'american'}).toString();
    return external(u.href);
  }));
  const events=[];const issues=[];
  for(let i=0;i<results.length;i++){
    const r=results[i];if(r.status!=='fulfilled'){issues.push(`${SPORTS[i]} unavailable`);continue;}
    for(const e of Array.isArray(r.value)?r.value:[]){
      const dk=(e.bookmakers||[]).find(b=>b.key==='draftkings');if(!dk)continue;
      const market=(dk.markets||[]).find(m=>m.key==='h2h');if(!market)continue;
      events.push({id:str(e.id),event:`${e.away_team} @ ${e.home_team}`,home:str(e.home_team),away:str(e.away_team),
        start:e.commence_time,source:'DraftKings via The Odds API',market:'moneyline',updatedAt:market.last_update||dk.last_update||null,
        observedAt:iso(),sport:e.sport_key,
        outcomes:market.outcomes.map(x=>({selection:str(x.name),american:safeNumber(x.price)})).filter(x=>x.american!==null)});
    }
  }
  if(results.every(r=>r.status==='rejected'))throw Error('Odds provider unavailable');
  return {events:events.slice(0,LIMIT),issues};
}

// Neon HTTPS SQL uses the same wire envelope as @neondatabase/serverless.
// SQL parameters, never user-generated SQL fragments.
export async function sql(query,params=[],options={}){
  const conn=options.url??process.env.DATABASE_URL;
  if(!conn)throw Error('Database not configured');
  const url=new URL(conn);
  if(!url.hostname.endsWith('.neon.tech'))throw Error('Unrecognized database host');
  const response=await (options.fetcher??fetch)(`https://${url.hostname}/sql`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(7000),
    headers:{'content-type':'application/json','Neon-Connection-String':conn,'Neon-Raw-Text-Output':'true','Neon-Array-Mode':'false'},
    body:JSON.stringify({query,params}),
  });
  if(!response.ok)throw Error(`Database unavailable (${response.status})`);
  const data=await response.json();
  if(data?.message&&data?.severity==='ERROR')throw Error('Database query rejected');
  return Array.isArray(data.rows)?data.rows:[];
}
async function getBankroll(){
  const rows=await sql("SELECT amount_cents::text AS cents,updated_at FROM kal_kings_bankroll WHERE venue='draftkings'");
  return {amount:rows.length?Number(rows[0].cents)/100:null,updatedAt:rows[0]?.updated_at||null};
}
async function updateBankroll(amount){
  const cents=Math.round(Number(amount)*100);
  if(!Number.isSafeInteger(cents)||cents<0||cents>1e11)throw Error('Balance must be 0 to $1 billion');
  const rows=await sql("INSERT INTO kal_kings_bankroll(venue,amount_cents,updated_at) VALUES ('draftkings',$1,now()) ON CONFLICT(venue) DO UPDATE SET amount_cents=EXCLUDED.amount_cents,updated_at=now() RETURNING amount_cents::text AS cents, updated_at",[String(cents)]);
  return {amount:Number(rows[0].cents)/100,updatedAt:rows[0].updated_at};
}
async function getWagers(){
  const rows=await sql("SELECT id,event_name,selection,odds_american,stake_cents::text AS stake_cents,payout_cents::text AS payout_cents,status,placed_at,settled_at FROM kal_kings_wagers ORDER BY placed_at DESC LIMIT 20");
  return rows.map(row=>({id:row.id,event:row.event_name,selection:row.selection,odds:row.odds_american,
    stake:Number(row.stake_cents)/100,payout:Number(row.payout_cents)/100,status:row.status,placedAt:row.placed_at,settledAt:row.settled_at}));
}
async function recordWager(data){
  const stakeCents=Math.round(Number(data.stake)*100);const odds=Number(data.odds);
  const event=str(data.event,160), selection=str(data.selection,100),id=randomUUID();
  if(!event||!selection||!Number.isInteger(odds)||Math.abs(odds)<100||!Number.isSafeInteger(stakeCents)||stakeCents<1)throw Error('Invalid DraftKings wager');
  const pairId=data.pairId==null||data.pairId===''?null:String(data.pairId);
  if(pairId&&!/^[0-9a-f-]{36}$/i.test(pairId))throw Error('Invalid reviewed pair identifier');
  if(pairId){const pair=await sql('SELECT id FROM kal_kings_pairs WHERE id=$1::uuid AND dk_selection=$2',[pairId,selection]);if(!pair.length)throw Error('Reviewed market pairing not found');}
  const rows=await sql(`WITH debit AS (UPDATE kal_kings_bankroll SET amount_cents=amount_cents-$1::bigint,updated_at=now() WHERE venue='draftkings' AND amount_cents >= $1::bigint RETURNING amount_cents)
    INSERT INTO kal_kings_wagers(id,venue,event_name,selection,odds_american,stake_cents,pair_id)
    SELECT $2::uuid,'draftkings',$3,$4,$5::int,$1::bigint,$6::uuid FROM debit RETURNING id`,[String(stakeCents),id,event,selection,String(odds),pairId]);
  if(!rows.length)throw Error('DraftKings balance insufficient or uninitialized');
  return {id,stake:stakeCents/100,pairId,selection,event,odds};
}
async function settleWager({id,payout}){
  const cents=Math.round(Number(payout)*100);
  if(!/^[0-9a-f-]{36}$/i.test(String(id))||!Number.isSafeInteger(cents)||cents<0)throw Error('Invalid settlement');
  const rows=await sql(`WITH settled AS (UPDATE kal_kings_wagers SET status='settled',payout_cents=$2::bigint,settled_at=now() WHERE id=$1::uuid AND status='open' RETURNING payout_cents), credit AS (UPDATE kal_kings_bankroll SET amount_cents=amount_cents+settled.payout_cents,updated_at=now() FROM settled WHERE venue='draftkings' RETURNING amount_cents) SELECT amount_cents::text AS cents FROM credit`,[id,String(cents)]);
  if(!rows.length)throw Error('Wager not found, already settled, or bankroll missing');
  return {amount:Number(rows[0].cents)/100};
}
async function savePair(data){
  const ticker=str(data.kalshiTicker,128),eventId=str(data.dkEventId,128),selection=str(data.selection,128),side=str(data.side,8).toLowerCase(),digest=str(data.ruleDigest,128);
  if(!/^[A-Z0-9_-]{4,128}$/i.test(ticker)||!eventId||!selection||!['yes','no'].includes(side)||!/^sha256:[0-9a-f]{64}$/i.test(digest))throw Error('Review requires exact event IDs and SHA-256 rules digest');
  const id=randomUUID();
  const rows=await sql('INSERT INTO kal_kings_pairs(id,kalshi_ticker,dk_event_id,dk_selection,kalshi_side,reviewed_rule_digest,reviewed_at) VALUES ($1::uuid,$2,$3,$4,$5,$6,now()) RETURNING id',[id,ticker,eventId,selection,side,digest]);
  return {id:rows[0].id};
}
async function getPairs(){return await sql('SELECT id,kalshi_ticker,dk_event_id,dk_selection,kalshi_side,reviewed_rule_digest,reviewed_at FROM kal_kings_pairs ORDER BY reviewed_at DESC LIMIT 100');}
async function getSoloOrders(){
 const rows=await sql('SELECT ticker,status,contracts,yes_price,no_price,net_profit_dollars,capital_reserved_dollars,yes_filled,no_filled,created_at,updated_at FROM kal_kings_solo_orders ORDER BY created_at DESC LIMIT 20');
 return rows.map(x=>({ticker:x.ticker,status:x.status,count:Number(x.contracts),yesPrice:Number(x.yes_price),noPrice:Number(x.no_price),
   projectedNet:Number(x.net_profit_dollars),capitalUsed:Number(x.capital_reserved_dollars),yesFilled:Number(x.yes_filled),noFilled:Number(x.no_filled),
   createdAt:x.created_at,updatedAt:x.updated_at}));
}
async function getAutoOrders(){
 const rows=await sql("SELECT wager_id,kalshi_ticker,status,count,limit_price,filled_count,created_at,updated_at FROM kal_kings_auto_orders ORDER BY created_at DESC LIMIT 12");
 return rows.map(x=>({wagerId:x.wager_id,ticker:x.kalshi_ticker,status:x.status,count:Number(x.count),
  price:Number(x.limit_price),filled:Number(x.filled_count),createdAt:x.created_at,updatedAt:x.updated_at}));
}
async function freshKalshiMarket(ticker){
  const body=await external(`${KALSHI_PUBLIC}/trade-api/v2/markets/${encodeURIComponent(ticker)}`);
  const m=body.market;
  if(!m||m.ticker!==ticker||!['active','open'].includes(m.status))return null;
  return {id:m.ticker,ticker:m.ticker,status:m.status,closeTime:m.close_time,
     eventTicker:m.event_ticker||null,seriesTicker:m.series_ticker||null,rulesPrimary:m.rules_primary||'',
     floorStrike:m.floor_strike==null?null:Number(m.floor_strike),
     event:m.title||m.ticker,
    yesAsk:m.yes_ask_dollars==null?Number(m.yes_ask)/100:Number(m.yes_ask_dollars),
    noAsk:m.no_ask_dollars==null?Number(m.no_ask)/100:Number(m.no_ask_dollars),
    yesBid:m.yes_bid_dollars==null?Number(m.yes_bid)/100:Number(m.yes_bid_dollars),
     noBid:m.no_bid_dollars==null?Number(m.no_bid)/100:Number(m.no_bid_dollars),
     noBidDepth:Number(m.no_bid_size_fp??m.no_bid_size??0),
    yesBidDepth:Number(m.yes_bid_size_fp??m.yes_bid_size??0),
    yesDepth:Number(m.yes_ask_size_fp??m.yes_ask_size??0),
    noDepth:Number(m.no_ask_size_fp??m.no_ask_size??0),observedAt:iso()};
}
async function automaticallyHedgeAcceptedDraftKingsTicket(ticket){
 if(!ticket.pairId)return {status:'NOT_APPLICABLE',note:'Unlinked DraftKings ticket was recorded; no Kalshi order.'};
 try{
  const pairs=await getPairs();
  const pair=pairs.find(x=>x.id===ticket.pairId);
  if(!pair)return {status:'SKIPPED',reason:'REVIEWED_PAIR_NOT_FOUND'};
  const [market,account]=await Promise.all([freshKalshiMarket(pair.kalshi_ticker),getKalshiAccount()]);
  const plan=buildKalshiHedgePlan({ticket:{...ticket,pair_id:ticket.pairId,status:'open',userConfirmed:true},
    mapping:pair,market,balance:account.balance,now:Date.now()});
  if(!plan.accepted)return {status:'SKIPPED',reason:plan.reason};
  const clientOrderId=randomUUID();
  const inserted=await sql(`INSERT INTO kal_kings_auto_orders (client_order_id,wager_id,kalshi_ticker,status,count,limit_price)
    VALUES ($1::uuid,$2::uuid,$3,'SUBMITTING',$4,$5) ON CONFLICT (wager_id) DO NOTHING RETURNING client_order_id`,
    [clientOrderId,ticket.id,plan.ticker,String(plan.count),plan.price.toFixed(4)]);
  if(!inserted.length)return {status:'ALREADY_ATTEMPTED',note:'The accepted wager has a previous Kalshi hedge attempt.'};
  const path='/trade-api/v2/portfolio/events/orders';
  const payload=kalshiV2Order({ticker:plan.ticker,count:plan.count,yesPrice:plan.price,clientOrderId});
  let orderId=null,filledCount=0,resultStatus='UNKNOWN';
  try{
    const response=await fetch(KALSHI+path,{method:'POST',headers:{...kalshiHeaders(path,'POST'),
      'content-type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(9000)});
    if(!response.ok)resultStatus='REJECTED';
    else {
      const responseData=await response.json();orderId=String(responseData.order_id||'').slice(0,128)||null;
      filledCount=Number(responseData.fill_count);
      if(!Number.isFinite(filledCount)||filledCount<0){filledCount=0;resultStatus='UNKNOWN';}
      else resultStatus=filledCount>=plan.count?'FILLED':filledCount===0?'NOT_FILLED':'PARTIALLY_FILLED';
    }
  }catch{/* Network timeouts are ambiguous: never resubmit the same ticket automatically. */}
  await sql(`UPDATE kal_kings_auto_orders SET status=$2,order_id=$3,filled_count=$4,updated_at=now()
    WHERE client_order_id=$1::uuid`,[clientOrderId,resultStatus,orderId,String(filledCount)]);
  return {status:resultStatus,filledCount,requestedContracts:plan.count,
    note:resultStatus==='UNKNOWN'?'Order response uncertain; reconcile on Kalshi before further trading.':'Only exchange-confirmed fills count as executed.'};
 }catch{return {status:'UNAVAILABLE',note:'Execution or reconciliation could not be verified; no automatic retry.'};}
}

// Independent quantitative screening, backed by actual exchange order-book depth.
// Historical snapshots are observations, never claims of executed trades.
const kalshiSeriesFeeCache=new Map();
async function getVerifiedKalshiFeeSchedule(ticker){
 const series=String(ticker||'').split('-')[0];
 if(!/^[A-Z0-9_]{4,60}$/.test(series))throw Error('Invalid series identifier');
 const cached=kalshiSeriesFeeCache.get(series);
 if(cached&&Date.now()-cached.at<3600000)return cached.schedule;
 const result=await external(`${KALSHI_PUBLIC}/trade-api/v2/series/${encodeURIComponent(series)}`);
 const feeType=result?.series?.fee_type;
 const feeMultiplier=Number(result?.series?.fee_multiplier);
 if(!['quadratic','quadratic_with_maker_fees',
     'quadratic_with_combo_maker_fees'].includes(feeType)||
     !Number.isFinite(feeMultiplier)||feeMultiplier<0||feeMultiplier>4)
   throw Error('Unverified or unsupported series fee structure');
 const schedule={feeType,feeMultiplier,source:'OFFICIAL_KALSHI_SERIES'};
 kalshiSeriesFeeCache.set(series,{schedule,at:Date.now()});
 return schedule;
}

async function getKalshiOrderbook(ticker){
 if(!/^[A-Z0-9_-]{4,128}$/.test(ticker||''))throw Error('Invalid Kalshi ticker');
 return external(`${KALSHI_PUBLIC}/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook?depth=30`);
}
async function recordQuantQuote(market){
 const id=str(market?.id,128),bid=Number(market?.yesBid),ask=Number(market?.yesAsk);
 const when=Date.parse(market?.observedAt||'');
 if(!/^[A-Z0-9_-]{4,128}$/.test(id)||!validPrice(bid)||!validPrice(ask)||
    !Number.isFinite(when)||Math.abs(Date.now()-when)>10000)return;
 await sql(`INSERT INTO kal_kings_market_observations(ticker,observed_at,bid,ask)
 VALUES($1,$2::timestamptz,$3::numeric,$4::numeric)
 ON CONFLICT(ticker,observed_at) DO NOTHING`,[id,market.observedAt,bid.toFixed(4),ask.toFixed(4)]);
}
async function recordQuantSamples(quotes){
 const batch=selectHistorySamples(quotes,Date.now(),12);
 if(!batch.length)return 0;
 const stored=await Promise.allSettled(batch.map(recordQuantQuote));
 if(stored.some(x=>x.status==='rejected'))throw Error('Unable to persist market observations');
 return batch.length;
}
async function getQuantHistory(ticker){
 const rows=await sql(`SELECT observed_at AS "observedAt",bid::text AS bid,ask::text AS ask
   FROM kal_kings_market_observations WHERE ticker=$1
   ORDER BY observed_at DESC LIMIT 240`,[ticker]);
 return rows.reverse().map(r=>({observedAt:r.observedAt,bid:Number(r.bid),ask:Number(r.ask)}));
}
async function getQuantExecutedFills(){
 const rows=await sql(`SELECT contracts::text AS count,yes_filled::text AS yes_filled,
 no_filled::text AS no_filled,status FROM kal_kings_solo_orders
 WHERE status IN ('HEDGED','UNHEDGED','NOT_FILLED','PARTIALLY_FILLED')
 ORDER BY updated_at DESC LIMIT 250`);
 return rows;
}
async function getQuantDiagnostics(){
 const [history,executions,rejections]=await Promise.all([
 sql('SELECT COUNT(*)::int AS n FROM kal_kings_market_observations'),
 sql(`SELECT COUNT(*)::int AS n FROM kal_kings_solo_orders
 WHERE status IN ('HEDGED','UNHEDGED','NOT_FILLED','PARTIALLY_FILLED')`),
 sql(`SELECT ticker,reason,accepted,calibration_status,observed_at FROM kal_kings_quant_decisions
 ORDER BY observed_at DESC LIMIT 5`)
 ]);
 return {...summarizeQuantState({historySamples:Number(history[0]?.n||0),
   executionSamples:Number(executions[0]?.n||0),decisions:rejections}),
   recent:rejections.map(r=>({ticker:r.ticker,reason:r.reason,
    accepted:r.accepted,confidence:r.calibration_status,at:r.observed_at}))};
}
async function quantRiskGate({quote,balance,holdings,positionsComplete,now}){
 let output={accepted:false,reason:'QUANT_DATA_UNAVAILABLE'};
 try{
   const [raw,history,executions]=await Promise.all([
     getKalshiOrderbook(quote.id),getQuantHistory(quote.id),getQuantExecutedFills()]);
   await recordQuantQuote(quote);
   output=assessLiveKalshiEntry({quote,bookResponse:raw,bankroll:balance,
     holdings,positionsComplete,history,executions,now,trials:5000,seed:43});
 }catch{/* No fallback to a price-only trade on missing market evidence */}
 // Any failed audit write also disables execution of the proposed candidate.
 await sql(`INSERT INTO kal_kings_quant_decisions(ticker,observed_at,accepted,reason,
   model_expected_dollars,model_tail_dollars,calibration_status,proposed_count)
   VALUES($1,now(),$2::boolean,$3,$4::numeric,$5::numeric,$6,$7::numeric)`,[
  quote?.id||'UNKNOWN',Boolean(output.accepted),output.reason,
  output.model?.meanPnl==null?null:String(output.model.meanPnl),
  output.model?.meanWorst5Percent==null?null:String(output.model.meanWorst5Percent),
  output.calibration?.status||'UNAVAILABLE',output.candidate?.count??null]);
 return output;
}
// Independent Kalshi-only engine. Does not read the DraftKings ledger or a
// reviewed Kalshi/DraftKings cross-venue match. The Neon timer drives it 24/7.
async function submitSoloOrder(order){
 const path='/trade-api/v2/portfolio/events/orders';
 const res=await fetch(KALSHI+path,{method:'POST',
  headers:{...kalshiHeaders(path,'POST'),'content-type':'application/json'},
  body:JSON.stringify(order),redirect:'error',signal:AbortSignal.timeout(9000)});
 if(!res.ok){
   const problem=new Error('Kalshi refused the order');
   problem.httpStatus=res.status;
   // Only the HTTP class is used for user-visible diagnostics. Never expose
   // raw Kalshi response bodies, signatures, or internal account details.
   throw problem;
 }
 const payload=await res.json();
 if(!payload||typeof payload.fill_count!=='string')throw Error('Unrecognized Kalshi execution receipt');
 return payload;
}
/** Explicit, one-time, at-most-three-cent production connectivity trade.
 * NEVER called by the recurring autonomous strategy. Funds are real and the
 * single speculative share can lose its full stake; no profitability claim.
 */
async function runOneTimeLiveTest(body){
 const ticker=str(body?.ticker,128).toUpperCase();
 if(!/^[A-Z0-9_-]{4,128}$/.test(ticker))return {status:'INVALID_TICKER'};
 const prior=await sql('SELECT test_id,status,market_ticker,exchange_order_id,filled_contracts,updated_at FROM kal_kings_live_tests WHERE test_id=$1',['initial-micro-live-v1']);
 if(prior.length)return {status:'ALREADY_ATTEMPTED',record:{status:prior[0].status,ticker:prior[0].market_ticker,filled:prior[0].filled_contracts,updatedAt:prior[0].updated_at}};
 const account=await getKalshiAccount();
 if(account.status!=='VERIFIED')return {status:'ACCOUNT_UNAVAILABLE'};
 const [market,book]=await Promise.all([freshKalshiMarket(ticker),getKalshiOrderbook(ticker)]);
 const decision=planOneTimeMicroOrder({ticker,marketStatus:market?'active':'unavailable',yesAsk:market?.yesAsk,book,balance:account.balance,positionsComplete:account.positionsComplete});
 if(!decision.allowed)return {status:'NOT_ELIGIBLE',reason:decision.reason};
 const testId='initial-micro-live-v1',clientId=randomUUID();
 const reserved=await sql(`INSERT INTO kal_kings_live_tests(test_id,client_order_id,market_ticker,limit_price,estimated_max_debit,status)
   VALUES($1,$2::uuid,$3,$4::numeric,$5::numeric,'SUBMITTING') ON CONFLICT (test_id) DO NOTHING RETURNING test_id`,
   [testId,clientId,ticker,String(decision.price),String(decision.totalMaxDollars)]);
 if(!reserved.length)return {status:'ALREADY_ATTEMPTED'};
 const order={ticker,client_order_id:clientId,side:'bid',count:'1.00',price:decision.price.toFixed(4),
   time_in_force:'fill_or_kill',self_trade_prevention_type:'taker_at_cross',cancel_order_on_pause:true};
 let status='UNCERTAIN',orderId=null,confirmed=0;
 try{
   const posted=await submitSoloOrder(order);
   orderId=typeof posted?.order_id==='string'&&posted.order_id.length<=128?posted.order_id:null;
   let fetched=null;
   if(orderId&&Number(posted?.fill_count)>0){
     try{fetched=await kalshiPrivate('/trade-api/v2/portfolio/orders/'+encodeURIComponent(orderId));}
     catch{/* Submitted but reconciliation unavailable; do not retry. */}
   }
   status=interpretMicroReceipt({post:posted,confirmed:fetched});
   if(status==='FILLED')confirmed=Number(fetched?.order?.fill_count_fp)||0;
 }catch{/* The request may have reached the venue; never resubmit blindly. */}
 await sql(`UPDATE kal_kings_live_tests SET status=$2,exchange_order_id=$3,filled_contracts=$4::numeric,updated_at=now() WHERE test_id=$1`,
  [testId,status,orderId,String(confirmed)]);
 return {status,testId,ticker,yesPrice:decision.price,maxPossibleDebitDollars:decision.totalMaxDollars,
   exchangeOrderId:orderId,confirmedFilledContracts:confirmed,
   note:'One speculative, one-time connectivity test; no expected-profit claim. Ambiguous receipts are never retried.'};
}
async function getOneTimeLiveTest(){
 const rows=await sql(`SELECT test_id,status,market_ticker,limit_price::text AS limit_price,estimated_max_debit::text AS estimated_max_debit,
 filled_contracts::text AS filled_contracts,exchange_order_id,created_at,updated_at FROM kal_kings_live_tests ORDER BY created_at DESC LIMIT 1`);
 return rows.length?{testId:rows[0].test_id,status:rows[0].status,ticker:rows[0].market_ticker,
  price:Number(rows[0].limit_price),maxDebit:Number(rows[0].estimated_max_debit),
  confirmedFilled:Number(rows[0].filled_contracts),orderId:rows[0].exchange_order_id,updatedAt:rows[0].updated_at}:null;
}
async function fetchKalshiSettlements(){
  const payload=await kalshiPrivate('/trade-api/v2/portfolio/settlements?limit=100');
  return Array.isArray(payload?.settlements)?payload.settlements:[];
}
const monitorKalshiPortfolio=makeKalshiLifecycle({fetchAccount:getKalshiAccount,
 fetchSettlements:fetchKalshiSettlements,fetchMarket:freshKalshiMarket,
 recordQuantQuote,getQuantHistory,quantExit:monteCarloExitDecision,
 sql,submit:submitSoloOrder,createId:randomUUID,now:Date.now});

// Parallel non-trading predictive scan, persisted to Neon for cross-refresh visibility.
// No inferred price momentum or scoreboard favorite may submit a wager: the
// current execution route still insists on independently validated price/edge.
const universeScanner=makeUniverseScanner({sql,fetcher:path=>external(KALSHI_PUBLIC+'/trade-api/v2'+path),now:Date.now,limit:500});
async function collectPredictiveStrategies(){
 const now=Date.now();
 const [cryptoResponse,sportsResponse,universeResponse]=await Promise.allSettled([
   memo('predictiveCrypto',20000,()=>fetchCryptoSignals({now:Date.now()})),
   fetchSportsSignals({now}),memo('universe_scan',30000,()=>universeScanner.scan())
 ]);
 const cryptos=cryptoResponse.status==='fulfilled'?cryptoResponse.value:[];
 const sports=sportsResponse.status==='fulfilled'?sportsResponse.value:[];
 try{
  await recordForecasts(sql,sports);
  await resolveForecasts(sql,async ticker=>(await external(`${KALSHI_PUBLIC}/trade-api/v2/markets/${encodeURIComponent(ticker)}`)).market);
 }catch{/* Incomplete history never invents settled results or authorizes orders. */}
 const rows=[
   ...cryptos.map(x=>({asset:x.symbol,strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',
     direction:x.direction==='UNKNOWN'?null:x.direction,status:x.status||'DATA_UNAVAILABLE',
     source_count:x.sources||0,market_ticker:x.marketTicker||null,details:x})),
   ...sports.flatMap(x=>[
     ...(x.exceededTotalsMarkets?.slice(0,4)||[]).map(m=>({asset:x.event,
        strategy:'TOTAL_ALREADY_OVER',direction:'OVER',status:'SCORE_EXCEEDS_CONTRACT',
        source_count:1,market_ticker:m.ticker,details:{...x,totalMarket:m}})),
     ...(x.lateGame?.direction?[{asset:x.event,strategy:'LATE_GAME_LEAD',
       direction:x.lateGame.direction,status:x.lateGame.reason,
       source_count:1,market_ticker:null,details:x}]:[]),
     ...(x.totals?.direction?[{asset:x.event,strategy:'OVER_UNDER_CONTEXT',
       direction:x.totals.direction,status:x.totals.reason,
       source_count:1,market_ticker:null,details:x}]:[])
   ])
 ];
 if(rows.length){
   await sql(`INSERT INTO kal_kings_predictive_signals
     (asset,strategy,direction,status,source_count,market_ticker,details,observed_at)
     SELECT p.asset,p.strategy,p.direction,p.status,p.source_count,p.market_ticker,p.details,now()
     FROM jsonb_to_recordset($1::jsonb) AS p(asset text,strategy text,direction text,status text,
       source_count integer,market_ticker text,details jsonb)`,[JSON.stringify(rows)]);
 }
 const totalIdeas=sports.flatMap(x=>{
   const markets=x.exceededTotalsMarkets?.length?x.exceededTotalsMarkets:
     (x.totalMarket?[x.totalMarket]:[]);
   if(!x.totalGame)return [];
   return markets.flatMap(m=>{
     const proof=verifyExceededTotal({game:x.totalGame,market:m,now});
     if(!proof.eligible)return [];
     const price=Number(m.yesAsk);
     if(!(price>0&&price<1)||!(Number(m.yesDepth)>=1))return [];
     // Discovery deliberately does not assume a single-share fee proves
     // profitability. The final Kalshi order check tests actual quantity,
     // official fee multiplier, executable book depth, and free cash.
     return [{...x,strategy:'TOTAL_ALREADY_OVER',id:'total:'+m.ticker,
       market:m,game:x.totalGame,sourceVerified:true,
       marketMatchVerified:true,conditionalOutcomeVerified:true,
       modeledLossFrequency:null,expectedNetDollars:null,
       estimatedMaxDebitDollars:null,allowed:false,
       requiresFeeVerification:true,possibleSettlementMargin:1-price}];
   });
 }).sort((a,b)=>b.possibleSettlementMargin-a.possibleSettlementMargin||
    Date.parse(a.market.closeTime)-Date.parse(b.market.closeTime));
 const rankedLate=rankStrategies(sports.filter(x=>x.lateGame?.direction&&x.sourceVerified&&
   x.marketMatchVerified&&x.market&&Number.isFinite(Number(x.externalWinProbability))&&
   x.externalWinProbability>=.70&&x.modelPlayId)
   .map(x=>{
     const p=Number(x.externalWinProbability),ask=Number(x.market?.yesAsk);
     const fee=Number.isFinite(ask)&&ask>0&&ask<1?
       estimatedKalshiBuyDebit(1,ask)-ask:Infinity;
     const edge=p-ask-fee;
     return {...x,strategy:'LATE_GAME_LEAD',probability:p,
       modeledLossFrequency:1-p,estimatedMaxDebitDollars:ask+fee,
       expectedNetDollars:edge,allowed:Number.isFinite(edge)&&edge>1e-9};
   }),{max:12});
 // Already-exceeded totals get FIRST re-price and fee verification.
 // Their preliminary quotes do not claim a guaranteed profit.
 const cryptoIdeas=rankCryptoCandidates(cryptos,{now,max:6});
 // Reserve independent priority slots for both live sports strategies and
 // crypto: one busy sports event cannot starve the crypto automation queue.
 const ideas=[...totalIdeas.slice(0,8),...rankedLate.slice(0,6),...cryptoIdeas.slice(0,6)];
 return {cryptoSignals:cryptos.length,sportsSignals:sports.length,stored:rows.length,ideas,universeScanned:universeResponse.status==='fulfilled'?universeResponse.value.scanned:0};
}
async function getPredictiveStrategies(){
 const rows=await sql(`SELECT DISTINCT ON (asset,strategy) asset,strategy,direction,status,
   source_count,market_ticker,details::text AS details,observed_at
   FROM kal_kings_predictive_signals ORDER BY asset,strategy,observed_at DESC LIMIT 40`);
 return rows.map(r=>({asset:r.asset,strategy:r.strategy,direction:r.direction,
   status:r.status,sourceCount:Number(r.source_count),marketTicker:r.market_ticker,
   updatedAt:r.observed_at,details:typeof r.details==='string'?JSON.parse(r.details):r.details}));
}

const monitorDirectionalPositions=makeDirectionalLifecycle({sql,
  fetchMarket:freshKalshiMarket,fetchOrderbook:getKalshiOrderbook,
  fetchSettlements:fetchKalshiSettlements,submit:submitSoloOrder,
  getBidHistory:getQuantHistory,recordQuote:recordQuantQuote,
  createId:randomUUID,now:Date.now});
const runDirectional=makeDirectionalRunner({sql,fetchMarket:freshKalshiMarket,
  fetchOrderbook:getKalshiOrderbook,fetchFeeSchedule:getVerifiedKalshiFeeSchedule,
  fetchFinalConsensus:async(symbol,idea)=>fetchFinalCryptoConsensus({
    symbol,ticker:idea?.market?.ticker,referencePrice:idea?.referencePrice,now:Date.now()}),
  submit:submitSoloOrder,createId:randomUUID,now:Date.now});
/** Read-only reconciliation. Kalshi's V2 writes are read back through
 * the authenticated /portfolio/orders listing. Never retry unknown writes.
 */
async function fetchKalshiOrdersForTicker(ticker){
 if(!/^[A-Z0-9_-]{4,128}$/.test(ticker||''))throw Error('Invalid market');
 let cursor=null,orders=[];
 for(let page=0;page<3;page++){
   const params=new URLSearchParams({ticker,limit:'100'});
   if(cursor)params.set('cursor',cursor);
   const data=await kalshiPrivate('/trade-api/v2/portfolio/orders?'+params);
   if(!Array.isArray(data?.orders))throw Error('Kalshi order read unavailable');
   orders.push(...data.orders);
   cursor=typeof data.cursor==='string'&&data.cursor?data.cursor:null;
   if(!cursor)break;
 }
 return orders;
}
const manualOrders=makeManualExecutor({sql,fetchAccount:getKalshiAccount,
  fetchMarket:freshKalshiMarket,fetchOrderbook:getKalshiOrderbook,
  fetchFeeSchedule:getVerifiedKalshiFeeSchedule,
  fetchOrders:fetchKalshiOrdersForTicker,
  submit:submitSoloOrder,createId:randomUUID,now:Date.now});
async function getManualOrders(){
 try{await memo('manual_reconcile',30000,()=>manualOrders.reconcilePending())}
 catch{/* A temporarily unavailable order-history API never turns an unknown fill into a rejection. */}
 const rows=await sql(`SELECT id,ticker,side,contracts,status,
   filled_count::text AS filled_count,limit_price::text AS limit_price,
   max_debit::text AS max_debit,last_error,created_at,updated_at
   FROM kal_kings_manual_intents
   WHERE status<>'PREVIEW' ORDER BY created_at DESC LIMIT 12`);
 return rows.map(r=>({id:r.id,ticker:r.ticker,side:r.side,
   contracts:Number(r.contracts),status:r.status,filled:Number(r.filled_count),
   price:Number(r.limit_price),maxDebit:Number(r.max_debit),
   reason:r.last_error||null,createdAt:r.created_at,updatedAt:r.updated_at}));
}
async function recordScannerStatus(result){
 const details={cryptoSignals:result.cryptoSignals||0,sportsSignals:result.sportsSignals||0,
   universeScanned:result.universeScanned||0,ideaCount:result.ideaCount||0,
   directionalReason:result.directionalReason||null,ticker:result.ticker||null};
 await sql(`INSERT INTO kal_kings_scanner_status
   (id,last_status,last_reason,details,updated_at)
   VALUES('main',$1,$2,$3::jsonb,now())
   ON CONFLICT(id) DO UPDATE SET last_status=EXCLUDED.last_status,
     last_reason=EXCLUDED.last_reason,details=EXCLUDED.details,updated_at=now()`,
   [String(result.status||'UNKNOWN'),result.reason||result.directionalReason||null,
    JSON.stringify(details)]);
}
async function getScannerStatus(){
 const rows=await sql(`SELECT last_status,last_reason,details::text AS details,updated_at
   FROM kal_kings_scanner_status WHERE id='main'`);
 const x=rows[0];
 return x?{status:x.last_status,reason:x.last_reason,
   details:typeof x.details==='string'?JSON.parse(x.details):x.details,
   updatedAt:x.updated_at}:{status:'NOT_YET_SCANNED'};
}

async function acquireTradingLease(invocationId){
 const rows=await sql(`INSERT INTO kal_kings_scan_lease(name,lease_id,locked_until)
 VALUES('automation',$1,now()+interval '90 seconds')
 ON CONFLICT(name) DO UPDATE SET lease_id=EXCLUDED.lease_id,
    locked_until=EXCLUDED.locked_until
 WHERE kal_kings_scan_lease.locked_until<now()
 RETURNING lease_id`,[invocationId]);
 return rows.length===1&&rows[0].lease_id===invocationId;
}
async function releaseTradingLease(invocationId){
 await sql(`UPDATE kal_kings_scan_lease SET locked_until=now()
 WHERE name='automation' AND lease_id=$1`,[invocationId]);
}
const runSolo=makeSoloRunner({fetchAccount:getKalshiAccount,fetchQuotes:publicKalshi,
 fetchMarket:freshKalshiMarket,monitorPositions:monitorKalshiPortfolio,
 quantRiskGate,recordSnapshots:recordQuantSamples,
 scanPredictive:collectPredictiveStrategies,
 monitorDirectional:monitorDirectionalPositions,executeDirectional:runDirectional,
 acquireScanLease:acquireTradingLease,releaseScanLease:releaseTradingLease,
 recordScan:recordScannerStatus,
 sql,submit:submitSoloOrder,createId:randomUUID,now:Date.now});
/** Three-second user-session execution checks; Neon scheduled minutes remain
 * the unattended fallback. Database bucket guards prevent duplicate cycles.
 */
async function runCryptoCycle(source='dashboard'){
 const tick=Math.floor(Date.now()/3000);
 const lock=await sql(`INSERT INTO kal_kings_crypto_cycles(tick_key,source,status)
   VALUES($1::bigint,$2,'STARTED') ON CONFLICT DO NOTHING RETURNING tick_key`,
   [String(tick),source]);
 if(!lock.length)return {status:'ALREADY_CHECKED'};
 let status='SCANNER_UNAVAILABLE',scanned=0,candidates=0,ticker=null,lastReason=null,stage='LEASE';
 const leaseId='crypto-'+tick+'-'+source;
 let leased=false;
 try{
   leased=await acquireTradingLease(leaseId);
   if(!leased)status='SCANNER_BUSY';
   else{
   stage='FETCH_SIGNALS_AND_ACCOUNT';
   const [signals,account]=await Promise.all([
     memo('predictiveCrypto',30000,()=>fetchCryptoSignals({now:Date.now()})),
     getKalshiAccount()
   ]);
   scanned=signals.length;
   stage='MAP_CRYPTO_CANDIDATES';
   const ideas=signals.map(x=>selectCryptoIdea(x,{now:Date.now()})).filter(Boolean);
   candidates=ideas.length;
   stage='CHECK_ACCOUNT_AND_EDGE';
   if(account?.status!=='VERIFIED'||account.positionsComplete!==true)
     status='ACCOUNT_UNAVAILABLE';
   else if(!ideas.length)status='NO_MODELED_POSITIVE_VALUE';
   else{
     stage='EXECUTE_PRICE_VERIFIED_ORDER';
     const result=await runDirectional({ideas,account});
     status=result.status;ticker=result.ticker||null;lastReason=result.reason||null;
   }
   }
 }catch{status='CRYPTO_SCAN_UNAVAILABLE';lastReason='STAGE_'+stage}
 finally{if(leased)try{await releaseTradingLease(leaseId)}catch{}}
 await sql(`UPDATE kal_kings_crypto_cycles SET status=$2,research_count=$3::integer,
   candidate_count=$4::integer,traded_ticker=$5,last_reason=$6,finished_at=now()
   WHERE tick_key=$1::bigint`,
   [String(tick),status,String(scanned),String(candidates),ticker,lastReason]);
 return {status,scanned,candidates,ticker};
}
async function getCryptoCycleStatus(){
 const rows=await sql(`SELECT source,status,research_count,candidate_count,
    traded_ticker,last_reason,finished_at
    FROM kal_kings_crypto_cycles
    ORDER BY tick_key DESC LIMIT 1`);
 const r=rows?.[0];
 return r?{status:r.status,source:r.source,scanned:Number(r.research_count||0),
   candidates:Number(r.candidate_count||0),ticker:r.traded_ticker||null,
   reason:r.last_reason||null,checkedAt:r.finished_at}:{status:'NO_SCANS_RECORDED',scanned:0,candidates:0};
}
async function getPositionWatches(){
 const rows=await sql(`SELECT ticker,position_side,status,entry_price::text AS entry_price,
 high_bid::text AS high_bid,exit_fill_count::text AS exit_fill_count,updated_at
 FROM kal_kings_position_watch ORDER BY updated_at DESC LIMIT 20`);
 return rows.map(r=>({ticker:r.ticker,direction:r.position_side,status:r.status,
  entryPrice:Number(r.entry_price),peakObservedBid:Number(r.high_bid),
  exitedContracts:r.exit_fill_count==null?null:Number(r.exit_fill_count),updatedAt:r.updated_at}));
}
async function getBotSettlements(){
 const rows=await sql('SELECT ticker,settled_at FROM kal_kings_bot_settlements ORDER BY settled_at DESC LIMIT 20');
 return rows.map(r=>({ticker:r.ticker,settledAt:r.settled_at}));
}

async function setting(name){const rows=await sql('SELECT value FROM kal_kings_settings WHERE key=$1',[name]);return rows[0]?.value||null;}
async function saveSetting(name,value){return sql('INSERT INTO kal_kings_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',[name,value]);}
function encryptionKey(){const v=process.env.KALKINGS_ADMIN_TOKEN;if(!v||v.length<32)throw Error('Admin secret not configured');return createHash('sha256').update(v).digest();}
function encryptSecret(value){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');}
function decryptSecret(value){const raw=Buffer.from(value,'base64');const iv=raw.subarray(0,12),tag=raw.subarray(12,28);const dec=createDecipheriv('aes-256-gcm',encryptionKey(),iv);dec.setAuthTag(tag);return Buffer.concat([dec.update(raw.subarray(28)),dec.final()]).toString('utf8');}
async function getOddsKey(){if(process.env.ODDS_API_KEY)return process.env.ODDS_API_KEY;try{const raw=await setting('odds_api_key');return raw?decryptSecret(raw):null;}catch{return null;}}
async function currentDraftKingsOdds(){const key=await getOddsKey();return key?draftKingsOdds(key):sharpFeedOdds();}

async function getTradingViewAlerts(){
 const rows=await sql(`SELECT alert_id AS id,symbol,direction,price::text AS price,signal_time AS "time",received_at AS "receivedAt",timeframe AS "interval"
  FROM kal_kings_tv_alerts WHERE signal_time >= now()-interval '2 minutes'
  ORDER BY signal_time DESC LIMIT 25`);
 return rows.map(r=>({...r,price:Number(r.price)}));
}
async function tradingViewEnabled(){
 const stored=await setting('tradingview_webhook_sha256');
 return typeof stored==='string'&&/^[a-f0-9]{64}$/.test(stored);
}
async function setTradingViewSecret(secret){
 if(typeof secret!=='string'||secret.length<24||secret.length>256)throw Error('Invalid webhook passphrase');
 await saveSetting('tradingview_webhook_sha256',createHash('sha256').update(secret).digest('hex'));
 return {saved:true,webhookPath:'/webhooks/tradingview'};
}
async function acceptTradingViewWebhook(body){
 const secret=body?.passphrase;
 if(typeof secret!=='string'||secret.length<24||secret.length>256)throw Error('Invalid TradingView passphrase');
 const expected=await setting('tradingview_webhook_sha256');
 if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw Error('TradingView webhook not configured');
 const actual=createHash('sha256').update(secret).digest('hex');
 if(!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw Error('Invalid TradingView passphrase');
 const alert=parseTradingViewAlert(body);
 await sql(`INSERT INTO kal_kings_tv_alerts (alert_id,symbol,direction,price,signal_time,received_at,timeframe)
 VALUES($1,$2,$3,$4::numeric,$5::timestamptz,$6::timestamptz,$7) ON CONFLICT(alert_id) DO NOTHING`,
 [alert.id,alert.symbol,alert.direction,String(alert.price),alert.time,alert.receivedAt,alert.interval]);
 return {accepted:true,alertId:alert.id,processedAt:iso(),executionApproved:false};
}

async function getKalshiAccount(){
  if(!requiredEnv().kalshiConfigured)return {status:'NOT_CONFIGURED',balance:null,holdings:[]};
  const [bal,position]=await Promise.all([
    kalshiPrivate('/trade-api/v2/portfolio/balance'),
    kalshiPrivate('/trade-api/v2/portfolio/positions?limit=1000&count_filter=position')
  ]);
  const value=bal.balance_dollars!=null?Number(bal.balance_dollars):Number(bal.balance)/100;
  if(!Number.isFinite(value)||value<0)throw Error('Unexpected Kalshi balance response');
  const positions=Array.isArray(position.market_positions)?position.market_positions:[];
  return {status:'VERIFIED',balance:value,portfolioValue:bal.portfolio_value==null?null:Number(bal.portfolio_value)/100,
    holdings:positions.map(p=>({ticker:str(p.ticker),position:safeNumber(p.position_fp??p.position),marketExposure:Number(p.market_exposure_dollars??p.market_exposure??0)})),
    positionsComplete:!position.cursor,
    observedAt:iso()};
}

export function evaluatedMatches(pairs,kalshi,draft,dkBalance,now=Date.now(),kalshiBalance=null){
  const opportunities=[];
  for(const pair of pairs){
    const km=kalshi.find(m=>m.id===pair.kalshi_ticker),de=draft.find(m=>m.id===pair.dk_event_id);
    const sel=de?.outcomes?.find(o=>o.selection===pair.dk_selection);
    const side=pair.kalshi_side,ask=km?.[side==='yes'?'yesAsk':'noAsk'];
    if(!sel||!validPrice(ask))continue;
    const reviewedAge=now-Date.parse(pair.reviewed_at);
    const withinReview=Number.isFinite(reviewedAge)&&reviewedAge>=0&&reviewedAge<604800000&&
      /^sha256:[0-9a-f]{64}$/i.test(pair.reviewed_rule_digest||'');
    const fresh=quoteAge(km,now)<=30000&&quoteAge(de,now)<=120000;
    if(!withinReview||!fresh)continue;
    const kb=kalshiBalance==null?0:Number(kalshiBalance),db=dkBalance==null?0:Number(dkBalance);
    let decimal;try{decimal=americanToDecimal(sel.american);}catch{continue;}
    const total=kb+db;
    const funded=kb>0&&db>0;
    const plan=funded?chooseHedge({kalshiAsk:ask,dkOdds:sel.american,kalshiBalance:kb,
      dkBalance:db,availableDepth:km[side==='yes'?'yesDepth':'noDepth'],bankroll:total}):null;
    // Quote-based analysis must work even before accounts are funded; it is NOT executable.
    const maximum=Number(km[side==='yes'?'yesDepth':'noDepth']);
    const count=plan?.kalshiContracts??(Number.isFinite(maximum)?Math.min(5,Math.floor(maximum)):0);
    if(count<1)continue;
    const stake=plan?.dkStakeDollars??cash(count/decimal);
    const fee=plan?.kalshiFeeDollars??estimatedKalshiFee(count,ask);
    const assessment=evaluatePair({contracts:count,kalshiAsk:ask,dkStake:stake,
      dkAmerican:sel.american,feeUSD:fee,reviewed:true,sameResolution:true,dkAccepted:false},now);
    const candidate={id:pair.id,event:de.event,selection:sel.selection,kalshiTicker:km.id,
      kalshiSide:side,kalshiAsk:ask,dkAmerican:sel.american,...assessment,
      fresh:true,reviewed:true,sameResolution:true,
      funded:Boolean(plan)&&kb>=plan.kalshiCostDollars&&db>=plan.dkStakeDollars,
      quoteUpdatedAt:de.updatedAt,requiresDraftKingsAction:true,
      modeledRiskLimit:total>0?riskPolicy(total).hardLossLimitDollars:0,
      comparisonOnly:false,
      disclaimer:'Conditional quoted spread only; neither leg has been executed. Settlement and fee review remain essential.'};
    if(candidate.minimumProfit<=0)continue;
    candidate.monteCarlo=monteCarlo(assessment,{trials:1500,winProbability:.5,secondLegFillProbability:.85});
    opportunities.push(candidate);
  }
  return opportunities.sort((a,b)=>b.minimumProfit-a.minimumProfit).slice(0,10);
}
async function diagnostics(){
 const probes=await Promise.allSettled([
   sql('SELECT 1 AS health'),
   requiredEnv().kalshiConfigured ? kalshiPrivate('/trade-api/v2/portfolio/balance') : Promise.reject(Error('not configured')),
   publicKalshi(), publicPolymarket(),cryptoSpot(),
 ]);
 const [db,auth,k,p,crypto]=probes;
 const bal=auth.status==='fulfilled' ? auth.value : null;
 const readable=bal&&((Number.isSafeInteger(bal.balance)&&bal.balance>=0)||(Number.isFinite(Number(bal.balance_dollars))&&Number(bal.balance_dollars)>=0));
 return {database:db.status==='fulfilled'?'READY':'UNAVAILABLE',
  kalshiAuthentication:readable?'VERIFIED':requiredEnv().kalshiConfigured?'UNAVAILABLE':'NOT_CONFIGURED',
  kalshiSportsQuotes:k.status==='fulfilled'?k.value.length:null,
  polymarketSportsQuotes:p.status==='fulfilled'?p.value.length:null,
  cryptocurrencyQuotes:crypto.status==='fulfilled'?crypto.value.length:null,
  unreviewedPriceGaps:k.status==='fulfilled'&&p.status==='fulfilled'?discoverQuotedGaps(k.value,[],p.value).length:null,
  draftkingsOdds:'SHARPAPI_ODDS_RELAY_CONFIGURED',
  checkedAt:iso()};
}
async function state(){
  const [kr,pr,dr,ar,br,wr,pairsr,cr,polyAuth,tvAlerts,tvTrends,tvReady,autoHistory,soloHistory,watches,settledPositions,quantReport]=await Promise.allSettled([
    memo('kalshi',TTL.kalshi,publicKalshi),
    memo('polymarket',TTL.polymarket,publicPolymarket),
    memo('draftkings',TTL.draftkings,currentDraftKingsOdds),
    memo('account',TTL.account,getKalshiAccount),getBankroll(),getWagers(),getPairs(),
    memo('crypto',TTL.crypto,cryptoSpot),memo('polyaccount',TTL.polyaccount,polyAccountCheck),getTradingViewAlerts(),memo('trends',TTL.trends,cryptoTrends),tradingViewEnabled(),getAutoOrders(),getSoloOrders(),getPositionWatches(),getBotSettlements(),getQuantDiagnostics()
  ]);
  const value=(r,fallback)=>r.status==='fulfilled'?r.value:fallback;
  const [predictive,strategyPerformance,directionalOrders,marketUniverse,scannerStatus,cryptoCycleStatus,manualOrderHistory]=await Promise.all([
    getPredictiveStrategies().catch(()=>[]),getStrategyPerformance(sql).catch(()=>({status:'UNAVAILABLE'})),
    getDirectionalOrders(sql).catch(()=>[]),universeScanner.latest().catch(()=>({status:'UNAVAILABLE',scanned:0,research:[]})),getScannerStatus().catch(()=>({status:'UNAVAILABLE'})),
    getCryptoCycleStatus().catch(()=>({status:'UNAVAILABLE',scanned:0,candidates:0})),
    getManualOrders().catch(()=>[])]);
  const k=value(kr,[]),p=value(pr,[]),d=value(dr,{events:[],issues:['Odds provider unavailable']});
  const account=value(ar,{status:'UNAVAILABLE',balance:null,holdings:[]});
  const bankroll=value(br,{amount:null,updatedAt:null});
  const reviewedPairs=value(pairsr,[]);
  const opportunities=evaluatedMatches(reviewedPairs,k,d.events,bankroll.amount,Date.now(),account.balance);
  const favorites=favoriteWatchlist(d.events);
  const priceGaps=discoverQuotedGaps(k,d.events,p,iso());
  const sportsTop={kalshi:topSports(k,10),draftkings:d.events.slice(0,10),polymarket:topSports(p,10)};
  const signals=directionalCandidates(reviewedPairs,k,d.events,account.balance);
  const allocationPolicy=account.balance!=null?riskPolicy(account.balance):null;
  const tradeBoard=buildTradeBoard({opportunities,signals,priceGaps,favorites});
  const ordersHistory=value(autoHistory,[]);
  const tradeReadiness=bankrollTradeStatus({balance:account.balance,opportunities,riskPolicy:allocationPolicy});
  const soloIdeas=account.balance==null?[]:findKalshiSoloCandidates(k,{balance:account.balance,now:Date.now()});
  const soloOrders=value(soloHistory,[]);
  const alerts=value(tvAlerts,[]),trends=value(tvTrends,[]);
  const enrichedCrypto=mergeCryptoAlerts(value(cr,[]),alerts).map(row=>({...row,
    technical:trends.find(t=>t.symbol===row.symbol)||null}));
  const feedDiagnostics={
    kalshiQuoteCount:k.length,polymarketQuoteCount:p.length,draftKingsQuoteCount:d.events.length,
    cryptoQuoteCount:value(cr,[]).length,reviewedPairCount:reviewedPairs.length,
    exploratoryGapCount:priceGaps.length,verifiedOpportunityCount:opportunities.length,
    draftKingsConnected:dr.status==='fulfilled'&&d.events.length>0,
    draftKingsFeedType:await getOddsKey()?'The Odds API':'SharpAPI odds relay',
    explanation:dr.status!=='fulfilled'||d.events.length===0?'DraftKings odds relay returned no eligible prices; see provider diagnostics.':
      reviewedPairs.length===0?'No reviewed identical-settlement match mappings exist yet; exploratory quote gaps are not executable arbitrage.':
      priceGaps.length===0?'No sufficiently close event/outcome matches with a quoted price difference were identified in the sampled markets.':
      'Indicative quote differences require settlement, depth and fee checks before they can be traded.',
  };
  return {service:'Kal Kings',refreshEveryMs:3000,asOf:iso(),feedDiagnostics,
   providers:{kalshi:{...cachedStatus('kalshi'),count:k.length,ready:kr.status==='fulfilled'},
    polymarket:{...cachedStatus('polymarket'),count:p.length,ready:pr.status==='fulfilled'&&p.length>0},
    draftkings:{...cachedStatus('draftkings'),count:d.events.length,ready:dr.status==='fulfilled'&&d.events.length>0,configured:feedDiagnostics.draftKingsConnected,issues:d.issues||[]}},
   balances:{kalshi:account.balance,draftkings:bankroll.amount,polymarket:null,updatedAt:bankroll.updatedAt},
   holdings:account.holdings,kalshiStatus:account.status,polymarketStatus:value(polyAuth,{status:'UNAVAILABLE'}).status,crypto:enrichedCrypto,
   tradingView:{configured:value(tvReady,false),alertsReceived:alerts.length,alerts,source:'TradingView configured webhooks; spot indicators computed from Coinbase'},
   quantitativeAnalysis:value(quantReport,{confidence:'DATA_UNAVAILABLE',verifiedExpectedProfit:null,recent:[]}),
   predictiveStrategies:predictive,strategyPerformance,directionalOrders,marketUniverse,scannerStatus,cryptoCycleStatus,manualOrderHistory,
   config:{...requiredEnv(),oddsFeedConfigured:true,neonStorageReady:br.status==='fulfilled'},
   quotes:{kalshi:k,polymarket:p,draftkings:d.events},
   opportunities,priceGaps,favorites,sportsSignals:signals,riskPolicy:allocationPolicy,wagers:value(wr,[]),
   automatedOrders:ordersHistory,automatedExecutionSummary:executionSummary(ordersHistory),
   kalshiSolo:{strategy:'Independent same-market complementary YES/NO quotes',scheduler:'Neon minute fallback plus authenticated five-second dashboard scans',
    opportunities:soloIdeas,orders:soloOrders,summary:summarizeSoloOrders(soloOrders),
    funded:account.balance!=null&&account.balance>0,autoWithoutDraftKings:true,
    cashReadyForReinvestment:cashAvailableForReinvestment(account).available,
    monitoredExits:value(watches,[]),settlements:value(settledPositions,[]),
    exitMethod:'Verified bot-owned position / observed-bid Monte Carlo plus stop/trailing exit / reduce-only IOC',
    entryMethod:'Exchange orderbook depth and fees / simulation-conditioned execution / correlated portfolio risk',
    note:'No DraftKings ticket is required. Both Kalshi legs must execute; one-sided fills remain exposed.'},
   tradeBoard,tradeReadiness,
   topSports:sportsTop,agent:activeAgent(),
   trading:{funded:tradeReadiness.funded,tradeReady:tradeReadiness.tradeReady,automaticOrdersEnabled:true,mode:'INDEPENDENT_KALSHI_SOLO_PLUS_SEPARATE_DRAFTKINGS_ARBITRAGE',draftKingsAutomaticOrdersEnabled:false,backgroundWorkerActive:true},
   notes:['Provider quote timestamps determine freshness, not page refresh frequency.',
    'Polymarket US is reference-only with no funded positions.',
    'Favorites shown as market-implied confidence, not verified positive-EV wagers.',
    'Risk scales with available bankroll; an exceptionally small account can be considered for a single affordable contract, but only on independently verified profitable terms.',
    'DraftKings via SharpAPI is market data only; no sportsbook wagering API is available.',
    'No cross-venue spread is risk-free until identical settlement rules and both fills are verified.'],
  };
}
export default {
  async fetch(request){
    const u=new URL(request.url),path=u.pathname;
    if(request.method==='GET'&&(path==='/'||path==='/index.html'))return new Response(HTML,{headers:{
      'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer','x-frame-options':'DENY',
      'content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src blob: 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://*.hf.co; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
    if(request.method==='GET'&&path==='/health'){
      const health={ok:true,service:'Kal Kings',uiServed:true,storageProvider:'Neon',
        credentialsAvailable:requiredEnv(),liveExecutionEnabled:true,asOf:iso()};
      if(u.searchParams.get('probe')==='1'){
        try{health.probes=await memo('healthDiagnostics',20000,diagnostics);}
        catch{health.probes={error:'Diagnostic provider unavailable'};}
      }
      return reply(health);
    }
    if(path==='/cron/kalshi-solo'){
      if(request.method!=='POST')return error(405,'Method not allowed');
      let body;
      try {if(Number(request.headers.get('content-length'))>4096)return error(413,'Payload too large');
        const raw=await request.text();if(raw.length>4096)return error(413,'Payload too large');body=JSON.parse(raw);
      }catch{return error(400,'Invalid trigger payload');}
      if(!isNeonSoloTrigger({'x-neon-trigger-invocation-id':request.headers.get('x-neon-trigger-invocation-id')},body))
        return error(403,'Not an authorized Neon schedule trigger');
      try{const sports=await runSolo({invocationId:body.invocation_id,scheduledAt:body.data.scheduled_at}); const crypto=await runCryptoCycle('schedule').catch(()=>({status:'UNAVAILABLE'})); return reply({...sports,crypto});}
      catch{return error(503,'Kalshi automation unavailable');}
    }
    if(path==='/webhooks/tradingview'){
      if(request.method!=='POST')return error(405,'Method not allowed');
      try{
        if(Number(request.headers.get('content-length'))>2048)return error(413,'Alert too large');
        const raw=await request.text();if(raw.length>2048)return error(413,'Alert too large');
        return reply(await acceptTradingViewWebhook(JSON.parse(raw)));
      }catch{return error(400,'TradingView alert rejected');}
    }
    if(!path.startsWith('/api/'))return error(404,'Not found');
    if(!allowEnvToken(request))return error(401,'Invalid administrator token');
    if(request.method==='GET'&&path==='/api/session')return reply({authenticated:true,service:'Kal Kings'});
    if(request.method==='POST'&&path==='/api/automation/tick'){
      const scan=activeScanSlot(Date.now());
      try{return reply(await runSolo(scan))}
      catch{return error(503,'Trade scanner unavailable')}
    }
    try{
      if(request.method==='GET'&&path==='/api/state')return reply(await state());
      if(request.method==='GET'&&path==='/api/kalshi/status'){
        const [cryptoCycleStatus,scannerStatus,manualOrderHistory]=await Promise.all([
          getCryptoCycleStatus().catch(()=>({status:'UNAVAILABLE',scanned:0,candidates:0})),
          getScannerStatus().catch(()=>({status:'UNAVAILABLE'})),
          getManualOrders().catch(()=>[])]);
        return reply({cryptoCycleStatus,scannerStatus,manualOrderHistory,asOf:iso()});
      }
      if(request.method==='GET'&&path==='/api/tradingview/alerts')return reply({alerts:await getTradingViewAlerts(),configured:await tradingViewEnabled()});
      if(request.method==='POST'&&path==='/api/tradingview/config')return reply(await setTradingViewSecret((await request.json()).passphrase));
      if(request.method==='GET'&&path==='/api/wagers')return reply({wagers:await getWagers()});
      if(request.method==='GET'&&path==='/api/automation/history')return reply({orders:await getAutoOrders()});
      if(request.method==='GET'&&path==='/api/kalshi/solo')return reply({orders:await getSoloOrders(),watches:await getPositionWatches(),settlements:await getBotSettlements()});
      if(request.method==='POST'&&path==='/api/kalshi/crypto-cycle')
        return reply(await runCryptoCycle('dashboard'));
      if(request.method==='GET'&&path==='/api/kalshi/manual/orders')return reply({orders:await getManualOrders()});
      if(request.method==='POST'&&path==='/api/kalshi/manual/preview')
        return reply(await manualOrders.preview(await request.json()));
      if(request.method==='POST'&&path==='/api/kalshi/manual/execute')
        return reply(await manualOrders.execute(await request.json()));
      if(request.method==='GET'&&path==='/api/kalshi/micro-test')return reply({test:await getOneTimeLiveTest()});
      if(request.method==='POST'&&path==='/api/kalshi/micro-test')return reply(await runOneTimeLiveTest(await request.json()));
      if(request.method==='GET'&&path==='/api/pairs')return reply({pairs:await getPairs()});
      if(request.method==='POST'&&path==='/api/dk/balance'){
        const body=await request.json();return reply(await updateBankroll(body.amount));
      }
      if(request.method==='POST'&&path==='/api/dk/wager'){
        const created=await recordWager(await request.json());
        const hedge=await automaticallyHedgeAcceptedDraftKingsTicket(created);
        return reply({created,kalshiAutomation:hedge});
      }
      if(request.method==='POST'&&path==='/api/dk/settle')return reply({balance:await settleWager(await request.json())});
      if(request.method==='POST'&&path==='/api/settings/odds-api'){
        const body=await request.json(); const key=str(body.key,128);
        if(key.length<8) return error(400,'Invalid odds API key');
        await saveSetting('odds_api_key',encryptSecret(key));cache.delete('draftkings');
        return reply({saved:true});
      }
      if(request.method==='POST'&&path==='/api/pairs')return reply({created:await savePair(await request.json())});
      if(request.method==='POST'&&path==='/api/simulate'){
        const body=await request.json();
        const pair=evaluatePair(body);
        return reply({pair,simulation:monteCarlo(pair,{trials:5000,winProbability:Number(body.winProbability??.5),secondLegFillProbability:Number(body.fillProbability??.85)})});
      }
      return error(404,'Route not found');
    }catch(e){
      const message=String(e?.message||'Error');
      const validation=/Invalid|not found|insufficient|uninitialized|Balance must/.test(message);
      // Never include provider response body, upstream keys, private key, SQL, or database URL.
      return error(validation?400:503,validation?message:'Service unavailable; check Neon Function configuration and upstream feeds');
    }
  }
};
