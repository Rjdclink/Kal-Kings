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
