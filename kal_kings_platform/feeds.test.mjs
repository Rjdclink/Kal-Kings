import test from 'node:test';
import assert from 'node:assert/strict';
import {collectKalshiSports, collectPolymarketSports, topSports, cryptoUniverse, discoverQuotedGaps} from './feeds.mjs';

test('Kalshi sports feed accepts documented event schema without required event.category',()=>{
  const pages=[{series:'KXNFLGAME',data:{events:[{event_ticker:'G1',title:'Steelers vs Colts',series_ticker:'KXNFLGAME',markets:[{ticker:'KXNFLGAME-1',yes_sub_title:'Steelers',yes_ask_dollars:'0.47',no_ask_dollars:'0.56',yes_ask_size_fp:'18',volume_fp:'1250',status:'active',updated_time:'2026-10-24T17:00:00Z'}]}]}}];
  const result=collectKalshiSports(pages,'2026-10-24T17:00:01Z');
  assert.equal(result.length,1);
  assert.equal(result[0].event,'Steelers vs Colts');
  assert.equal(result[0].yesAsk,.47);
  assert.equal(result[0].metadataUpdatedAt,'2026-10-24T17:00:00Z');
});
test('Kalshi feed aggregates diverse events up to max 200 and deduplicates tickers',()=>{
  const pages=['KXNFLGAME','KXNBAGAME'].map((series,i)=>({series,data:{events:Array.from({length:110},(_,j)=>({event_ticker:`e-${i}-${j}`,title:`Home-${j} @ Away-${i}`,series_ticker:series,markets:[{ticker:`${series}-${j}`,yes_sub_title:'Away',yes_ask_dollars:'0.42',yes_ask_size_fp:'10',volume_fp:String(j)}]}))}}));
  const r=collectKalshiSports(pages,'2026-10-24T17:00:00Z');
  assert.equal(r.length,200);
  assert.equal(new Set(r.map(x=>x.id)).size,r.length);
  assert.ok(new Set(r.map(x=>x.sport)).size>=2);
});
test('Polymarket feed detects verified sports markets with marketSides and skips non-sports',()=>{
  const result=collectPolymarketSports([{markets:[{slug:'sports-yes',active:true,closed:false,category:'Sports',question:'Steelers win',marketSides:[{name:'Yes',bestAskQuote:{value:.63}}],updatedAt:'2026-10-24T17:00:00Z'}, {slug:'non-sport',category:'Politics',active:true,closed:false,bestAskQuote:{value:.45}}]}],'2026-10-24T17:00:01Z');
  assert.equal(result.length,1);
  assert.equal(result[0].yesAsk,.63);
});
test('Top 10 sports displays unique games before secondary markets',()=>{
  const rows=Array.from({length:20},(_,i)=>({id:String(i),event:i<15?'Repeated Game':`Game ${i}`,label:'Team',yesAsk:.45,noAsk:.57,volume:20-i}));
  const r=topSports(rows,10);
  assert.equal(r.length,10);
  assert.equal(new Set(r.map(x=>x.event)).size,6);
});
test('Crypto universe contains six major symbols',()=>assert.deepEqual(cryptoUniverse,['BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD','ADA-USD']));
test('Cross-platform price gaps are discovered but not called risk-free arbitrage',()=>{
  const k=[{id:'K1',event:'Steelers vs Colts',label:'Steelers',yesAsk:.55,updatedAt:'2026-10-24T17:00:00Z'}];
  const d=[{id:'D1',event:'Steelers @ Colts',updatedAt:'2026-10-24T17:00:00Z',outcomes:[{selection:'Steelers',american:+150},{selection:'Colts',american:-170}]}];
  const result=discoverQuotedGaps(k,d,[],'2026-10-24T17:00:01Z');
  assert.equal(result.length,1);
  assert.equal(result[0].status,'REVIEW_ONLY');
  assert.equal(result[0].profitable,false);
  assert.equal(result[0].priceGapPercentagePoints,15);
});

test('Polymarket US live schema reads long and short quote values and identifies exact side labels',()=>{
 const feed=collectPolymarketSports([{markets:[{
   slug:'nfl-steelers-colts',active:true,closed:false,category:'sports',sportsMarketType:'moneyline',question:'Steelers vs Colts',
   updatedAt:'2026-10-24T17:00:18Z',ep3SyncedAt:'2026-10-22T11:51:19Z',endDate:'2026-10-26T00:00:00Z',
   marketSides:[{long:true,description:'Steelers',quote:{value:'0.6200'}},{long:false,description:'Colts',quote:{value:'0.3900'}}]
 }]}], '2026-10-24T17:00:20Z');
 assert.equal(feed.length,1);
 assert.equal(feed[0].yesAsk,.62);
 assert.equal(feed[0].noAsk,.39);
 assert.equal(feed[0].label,'Steelers');
 assert.equal(feed[0].opponentLabel,'Colts');
 assert.equal(feed[0].updatedAt,'2026-10-24T17:00:18Z');
});

test('Polymarket rejects expired active markets instead of repeating old contracts',()=>{
 const feed=collectPolymarketSports([{markets:[{
   slug:'nfl-old',active:true,closed:false,category:'sports',sportsMarketType:'moneyline',question:'Old Game',endDate:'2025-10-20T00:00:00Z',
   marketSides:[{long:true,description:'Team',quote:{value:'0.6100'}}]
 }]}], '2026-10-24T17:00:20Z');
 assert.equal(feed.length,0);
});

test('quote polling timestamp is fresh even if metadata sync predates it',async()=>{
 const {quoteAge}=await import('./engine.mjs');
 assert.equal(quoteAge({observedAt:'2026-10-24T17:00:19Z',updatedAt:'2026-10-22T11:51:19Z'},Date.parse('2026-10-24T17:00:20Z')),1000);
});

test('cross exchange price comparison only matches same team outcome',()=>{
 const at='2026-10-24T17:00:20Z';
 const k=[{id:'K1',event:'Steelers vs Colts',label:'Steelers',yesAsk:.61,observedAt:at}];
 const p=[{id:'P1',event:'Steelers vs Colts',label:'Steelers',opponentLabel:'Colts',yesAsk:.68,noAsk:.33,observedAt:at}];
 const gaps=discoverQuotedGaps(k,[],p,at);
 assert.equal(gaps.length,1);
 assert.equal(gaps[0].priceGapPercentagePoints,7);
 assert.equal(gaps[0].profitable,false);
 assert.equal(discoverQuotedGaps(k,[],[{...p[0],label:'Colts',opponentLabel:'Steelers'}],at).length,0);
});
test('three-way quote discovery includes DraftKings vs Polymarket when exact team is matched',()=>{
 const at='2026-10-24T17:00:20Z';
 const dk=[{id:'DK1',event:'Steelers vs Colts',observedAt:at,outcomes:[{selection:'Steelers',american:150},{selection:'Colts',american:-170}]}];
 const pm=[{id:'PM1',event:'Steelers vs Colts',label:'Steelers',opponentLabel:'Colts',yesAsk:.52,noAsk:.50,observedAt:at}];
 const out=discoverQuotedGaps([],dk,pm,at);
 assert.equal(out.length,1);
 assert.equal(out[0].marketA,'DraftKings');
 assert.equal(out[0].marketB,'Polymarket US');
 assert.equal(out[0].profitable,false);
});
test('Kalshi public sports normalization retains bid and bid depth for historical calibration',()=>{
 const pages=[{series:'KXNFLGAME',data:{events:[{title:'Test game',markets:[{
  ticker:'KXNFLGAME-2026-TEST',status:'active',yes_bid_dollars:'0.4300',yes_ask_dollars:'0.4700',
  no_bid_dollars:'0.5300',no_ask_dollars:'0.5700',yes_bid_size_fp:'12.00',
  no_bid_size_fp:'8.00',yes_ask_size_fp:'5.00',no_ask_size_fp:'9.00'}]}]}}];
 const [quote]=collectKalshiSports(pages,'2026-10-24T20:30:00Z');
 assert.equal(quote.yesBid,.43);
 assert.equal(quote.noBid,.53);
 assert.equal(quote.yesBidDepth,12);
 assert.equal(quote.noBidDepth,8);
 assert.equal(quote.yesAsk,.47);
});
