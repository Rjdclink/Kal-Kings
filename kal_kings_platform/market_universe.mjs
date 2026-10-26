/** Rotating, category-inclusive Kalshi market discovery.
 * Discovery is not an independent win forecast and never places an order.
 */
const numeric=x=>x===null||x===undefined||x===''?NaN:Number(x);
const positive=x=>Number.isFinite(x)&&x>0&&x<1;
const clean=(x,max=180)=>String(x||'').trim().slice(0,max);
const groups=[
  ['SPORTS',/^(KXNFL|KXNBA|KXNHL|KXMLB|KXCFB|KXCBB|KXEPL|KXMLS|KXSPORT|KXUFC|KXTENNIS|KXNCAA|KXWNBA)/],
  ['CRYPTO',/^(KXBTC|KXETH|KXSOL|KXXRP|KXDOGE|KXADA|KXBNB|KXLINK|KXDOT|KXZEC|KXLTC|KXCRYPTO|BTCMAX)/],
  ['WEATHER',/^(KXHIGH|KXLOW|KXRAIN|KXSNOW|KXTEMP|KXHURRICANE|KXWIND|KXHEAT)/],
  ['ECONOMICS',/^(KXCPI|KXPCE|KXGDP|KXFED|KXUNEMP|KXJOBS|KXNFP|KXINFLATION|KXRECESSION)/],
  ['ELECTIONS',/^(KXPRES|KXHOUSE|KXSENATE|KXGOV|KXPRIMARY|KXELECTION|KXCONGRESS)/],
  ['FINANCIALS',/^(KXSPX|KXSP500|KXNASDAQ|KXDJIA|KXRATE|KXSTOCK)/],
  ['SCIENCE_TECH',/^(KXAI|KXTECH|KXSPACE|KXLAUNCH|KXROCKET)/]
];
export function classifyKalshiMarket(row){
 const symbol=String(row?.series||row?.ticker||'').split('-')[0].toUpperCase();
 return groups.find(([_,re])=>re.test(symbol))?.[0]||'OTHER';
}
export function normalizeKalshiMarket(m,now=Date.now()){
 if(!m||typeof m.ticker!=='string'||!/^[A-Z0-9_-]{4,128}$/.test(m.ticker)||
   !['open','active'].includes(m.status)||m.market_type&&m.market_type!=='binary')return null;
 const expiration=Date.parse(m.close_time||'');
 if(!Number.isFinite(expiration)||expiration<=now)return null;
 const yes=numeric(m.yes_ask_dollars??(m.yes_ask!=null?Number(m.yes_ask)/100:null));
 const no=numeric(m.no_ask_dollars??(m.no_ask!=null?Number(m.no_ask)/100:null));
 if(!positive(yes)&&!positive(no))return null;
 const bid=numeric(m.yes_bid_dollars??(m.yes_bid!=null?Number(m.yes_bid)/100:null));
 const noBid=numeric(m.no_bid_dollars??(m.no_bid!=null?Number(m.no_bid)/100:null));
 const depth=numeric(m.yes_ask_size_fp??m.yes_ask_size);
 const noDepth=numeric(m.no_ask_size_fp??m.no_ask_size);
 const volume=numeric(m.volume_24h_fp??m.volume_24h??m.volume_fp??m.volume);
 const ticker=m.ticker,series=ticker.split('-')[0];
 const result={ticker,series,eventTicker:clean(m.event_ticker,145),
   title:clean(m.title||m.yes_sub_title||ticker),status:m.status,yesAsk:positive(yes)?yes:null,
   noAsk:positive(no)?no:null,yesBid:positive(bid)?bid:null,noBid:positive(noBid)?noBid:null,
   yesDepth:Number.isFinite(depth)&&depth>=0?depth:null,
   noDepth:Number.isFinite(noDepth)&&noDepth>=0?noDepth:null,
   volume24h:Number.isFinite(volume)&&volume>=0?volume:0,
   closeTime:m.close_time,observedAt:new Date(now).toISOString(),category:null,
   verifiedExpectedProfit:null,eligibleForAutomation:false,reviewOnly:true,
   note:'Tradable quote only. No independent model of fair value or verified net profit.'};
 result.category=classifyKalshiMarket(result);
 return result;
}
export function rankUniverseIdeas(rows,{max=24}={}){
 const eligible=(Array.isArray(rows)?rows:[]).filter(r=>r?.ticker&&
   (positive(r.yesAsk)||positive(r.noAsk)));
 const scored=eligible.map(x=>{
   const yesSpread=x.yesAsk!=null&&x.yesBid!=null?x.yesAsk-x.yesBid:1;
   const noSpread=x.noAsk!=null&&x.noBid!=null?x.noAsk-x.noBid:1;
   const spread=Math.min(yesSpread,noSpread);
   const liq=Math.min(100000,Number(x.volume24h||0));
   return {...x,discoveryScore:Math.round(1000*Math.log1p(liq)/(1+Math.max(0,spread)*50))/1000,
     estimatedPriceSpread:Math.round(spread*10000)/10000};
 }).sort((a,b)=>b.discoveryScore-a.discoveryScore);
 const output=[],used=new Set();
 // Cover different kinds of instruments before filling by liquidity.
 for(const x of scored)if(!used.has(x.category)){output.push(x);used.add(x.category);if(output.length>=max)return output;}
 for(const x of scored){if(output.some(y=>y.ticker===x.ticker))continue;output.push(x);if(output.length>=max)break;}
 return output;
}
export async function scanUniversePage({fetcher,cursor='',now=Date.now(),limit=500}={}){
 if(typeof fetcher!=='function')throw Error('Missing public market data adapter');
 const pageSize=Math.min(1000,Math.max(10,Math.floor(Number(limit)||500)));
 const params=new URLSearchParams({status:'open',mve_filter:'exclude',limit:String(pageSize)});
 if(cursor)params.set('cursor',String(cursor));
 const path='/markets?'+params.toString();
 const data=await fetcher(path);
 if(!Array.isArray(data?.markets))throw Error('Kalshi public market list malformed');
 const rows=data.markets.map(m=>normalizeKalshiMarket(m,now)).filter(Boolean);
 const byCategory={};
 for(const r of rows)byCategory[r.category]=(byCategory[r.category]||0)+1;
 return {scanned:data.markets.length,eligibleQuoted:rows.length,byCategory,
   nextCursor:typeof data.cursor==='string'&&data.cursor?data.cursor:null,
   research:rankUniverseIdeas(rows),marketSample:rows,
   completedSweep:!data.cursor,asOf:new Date(now).toISOString(),
   note:'Rolling page of a larger Kalshi market universe. Research prices do not establish profitable trades.'};
}
