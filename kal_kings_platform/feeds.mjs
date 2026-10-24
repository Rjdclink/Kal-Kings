/** Quote normalization and ranking. Never infer settlement equivalence from a name. */
import {americanToDecimal, normalizedTitle, suggestSimilarMarkets, validPrice, quoteAge} from './engine.mjs';
const label=(v,max=240)=>String(v??'').slice(0,max).trim();
const decimal=v=>v===null||v===undefined||v===''?null:Number(v);
const validAsk=v=>{const n=decimal(v);return Number.isFinite(n)&&n>0&&n<1?n:null;};
const hasAsk=m=>validAsk(m?.yesAsk)!==null||validAsk(m?.noAsk)!==null;
export const cryptoUniverse=Object.freeze(['BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','ADA-USD']);

export function topSports(rows,limit=10){
  const usable=(rows||[]).filter(hasAsk);
  const sort=(a,b)=>(Number(b.volume||0)-Number(a.volume||0))||String(a.event).localeCompare(String(b.event));
  const sorted=[...usable].sort(sort),picked=[],events=new Set(),ids=new Set();
  for(const item of sorted){
    const event=(item.event||item.label||item.id||'').toLowerCase().trim();
    if(ids.has(item.id)||events.has(event))continue;
    events.add(event);ids.add(item.id);picked.push(item);
    if(picked.length>=limit)return picked;
  }
  for(const item of sorted){if(ids.has(item.id))continue;ids.add(item.id);picked.push(item);if(picked.length>=limit)break;}
  return picked;
}

export function collectKalshiSports(pages,observedAt=new Date().toISOString(),limit=200){
  const rows=[],seen=new Set();
  for(const page of pages){
    const series=page.series||'';
    const events=Array.isArray(page.data?.events)?page.data.events:[];
    for(const event of events){
      // The series-ticker filter establishes sports; the event.category field is optional/deprecated.
      for(const market of (event.markets||[])){
        if(!market.ticker||seen.has(market.ticker)||market.status&&!['open','active'].includes(market.status))continue;
        const yesAsk=validAsk(market.yes_ask_dollars??(market.yes_ask!=null?Number(market.yes_ask)/100:null));
        const noAsk=validAsk(market.no_ask_dollars??(market.no_ask!=null?Number(market.no_ask)/100:null));
        if(yesAsk===null&&noAsk===null)continue;
        seen.add(market.ticker);
        rows.push({id:label(market.ticker,140),event:label(event.title||event.event_ticker),
          label:label(market.yes_sub_title||market.title||market.ticker),yesAsk,noAsk,
          yesDepth:decimal(market.yes_ask_size_fp??market.yes_ask_size),
          noDepth:decimal(market.no_ask_size_fp??market.no_ask_size),
          volume:decimal(market.volume_fp??market.volume)||0,
          observedAt,updatedAt:market.updated_time||event.last_updated_ts||null,
          metadataUpdatedAt:market.updated_time||event.last_updated_ts||null,
          source:'Kalshi',sport:label(event.series_ticker||series),
          rulesAvailable:Boolean(market.rules_primary||market.rules_secondary),
          closeTime:market.close_time||null});
      }
    }
  }
  // Broader market coverage wins over repeated low-volume outcomes from one game.
  const ordered=topSports(rows,limit);
  return ordered;
}

export function collectPolymarketSports(pages,observedAt=new Date().toISOString(),limit=200){
  const seen=new Set(),rows=[];
  const observedMs=Date.parse(observedAt);
  for(const page of pages){
    const markets=Array.isArray(page?.markets)?page.markets:Array.isArray(page?.data?.markets)?page.data.markets:[];
    for(const m of markets){
      if(!m?.slug||seen.has(m.slug)||m.active===false||m.closed===true||m.archived===true)continue;
      if(!(String(m.category||'').toLowerCase().includes('sport')||Boolean(m.sportsMarketType||m.sportsMarketTypeV2)))continue;
      // The public US retail API has `marketSides[].long` and `quote.value`.
      // `ep3SyncedAt` refers to metadata synchronization, NOT the last quote update.
      if(m.endDate&&Number.isFinite(Date.parse(m.endDate))&&Date.parse(m.endDate)<observedMs)continue;
      const sides=Array.isArray(m.marketSides)?m.marketSides:[];
      const long=sides.find(side=>side.long===true)||sides.find(side=>/^(yes|long)$/i.test(String(side.name||side.label||side.side||'')));
      const short=sides.find(side=>side.long===false)||sides.find(side=>/^(no|short)$/i.test(String(side.name||side.label||side.side||'')));
      const yesAsk=validAsk(m.bestAskQuote?.value??long?.bestAskQuote?.value??long?.quote?.value??long?.price??m.ask);
      const noAsk=validAsk(m.bestNoAskQuote?.value??short?.bestAskQuote?.value??short?.quote?.value??short?.price);
      if(yesAsk===null&&noAsk===null)continue;
      seen.add(m.slug);
      rows.push({id:label(m.slug,140),event:label(m.question||m.title||m.slug),
        label:label(long?.description||long?.team?.name||long?.name||m.subtitle||m.question||m.slug),
        opponentLabel:label(short?.description||short?.team?.name||short?.name||''),
        yesAsk,noAsk,
        volume:decimal(m.volumeNum??m.volume)||0,observedAt,updatedAt:m.updatedAt||long?.updatedAt||short?.updatedAt||null,
        metadataUpdatedAt:m.ep3SyncedAt||null,
        source:'Polymarket US',sport:label(m.sportsMarketTypeV2||m.sportsMarketType||m.category||'Sports'),
        priceType:'listed_side_quote_unverified_depth',referenceOnly:true});
    }
  }
  return topSports(rows,limit);
}

const cashPrice=n=>Math.round(n*10000)/100;
export function discoverQuotedGaps(kalshi,draft,poly,now=new Date().toISOString(),max=10){
  const nowMs=Date.parse(now),out=[];
  for(const km of kalshi){
    if(!validPrice(km.yesAsk)||quoteAge(km,nowMs)>60_000)continue;
    for(const event of draft){
      if(quoteAge(event,nowMs)>180_000||!suggestSimilarMarkets(km.event,event.event))continue;
      // Only compare the YES team to the *same* DraftKings outcome. Merely matching events is insufficient.
      const selection=event.outcomes?.find(x=>normalizedTitle(x.selection)===normalizedTitle(km.label));
      if(!selection)continue;
      let probability;
      try{probability=1/americanToDecimal(selection.american);}catch{continue;}
      const gap=Math.abs(km.yesAsk-probability);
      if(gap<.005)continue;
      out.push({id:`dk-${km.id}-${event.id}`,event:km.event,selection:km.label,
        marketA:'Kalshi',marketB:'DraftKings',priceA:km.yesAsk,priceB:probability,
        priceGapPercentagePoints:cashPrice(gap),status:'REVIEW_ONLY',profitable:false,
        updatedAt:km.updatedAt,explanation:'Different quote levels; not a verified hedge or independently modeled value.'});
    }
    for(const pm of poly){
      if(!validPrice(pm.yesAsk)||quoteAge(pm,nowMs)>60_000||!suggestSimilarMarkets(km.event,pm.event))continue;
      // A same-event comparison is not enough; the position itself must have the same named outcome.
      // The opposite team is deliberately NOT a substitute for the long side.
      if(normalizedTitle(km.label)!==normalizedTitle(pm.label))continue;
      const gap=Math.abs(km.yesAsk-pm.yesAsk);if(gap<.005)continue;
      out.push({id:`pm-${km.id}-${pm.id}`,event:km.event,selection:km.label,
        marketA:'Kalshi',marketB:'Polymarket US',priceA:km.yesAsk,priceB:pm.yesAsk,
        priceGapPercentagePoints:cashPrice(gap),status:'REVIEW_ONLY',profitable:false,
        updatedAt:km.updatedAt,explanation:'Possible price mismatch. Outcome identity, fees, liquidity and settlement require review.'});
    }
  }
  return out.sort((a,b)=>b.priceGapPercentagePoints-a.priceGapPercentagePoints).slice(0,max);
}
