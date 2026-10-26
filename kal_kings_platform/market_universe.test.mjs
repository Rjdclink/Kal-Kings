import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyKalshiMarket,normalizeKalshiMarket,scanUniversePage,rankUniverseIdeas} from './market_universe.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const market=(ticker,override={})=>({ticker,event_ticker:ticker.split('-').slice(0,2).join('-'),status:'active',
  market_type:'binary',yes_ask_dollars:'0.4200',no_ask_dollars:'0.5900',
  yes_bid_dollars:'0.4100',no_bid_dollars:'0.5800',yes_ask_size_fp:'22.00',no_ask_size_fp:'22.00',
  volume_fp:'1200.00',close_time:new Date(now+2*86400000).toISOString(),
  rules_primary:'If the event happens, resolves to Yes.',title:'Event',...override});
test('classifies sports crypto climate economics politics without declaring profit',()=>{
 for(const [ticker,expected] of [
  ['KXNFLGAME-26OCT26DALPHI-PHI','SPORTS'],['KXBTC15M-26OCT261230-30','CRYPTO'],
  ['KXHIGHNY-26OCT26-T75','WEATHER'],['KXCPI-26NOV-T3','ECONOMICS'],
  ['KXPRES-2028-T1','ELECTIONS'],['KXUNKNOWN-26OCT26-T1','OTHER']]){
  const row=normalizeKalshiMarket(market(ticker),now);
  assert.equal(classifyKalshiMarket(row),expected);
  assert.equal(row.eligibleForAutomation,false);
 }
});
test('continuous market scanner paginates across all series rather than eight hardcoded sports series',async()=>{
 let url='';
 const fetcher=async path=>{url=path;return{markets:[market('KXBTC15M-26OCT261230-30'),market('KXCPI-26NOV-T3')],cursor:'nextPage'}};
 const result=await scanUniversePage({fetcher,cursor:'previousPage',now,limit:500});
 assert.ok(url.includes('cursor=previousPage'));assert.ok(url.includes('mve_filter=exclude'));
 assert.equal(result.scanned,2);assert.equal(result.nextCursor,'nextPage');assert.equal(result.byCategory.CRYPTO,1);
 assert.equal(result.byCategory.ECONOMICS,1);
});
test('market list never invents a profitable opportunity from a liquid quoted contract',()=>{
 const rows=[normalizeKalshiMarket(market('KXBTC15M-26OCT261230-30'),now)];
 const ideas=rankUniverseIdeas(rows);
 assert.equal(ideas.length,1);assert.equal(ideas[0].verifiedExpectedProfit,null);
 assert.equal(ideas[0].eligibleForAutomation,false);
});
test('unpriced inactive and expired contracts cannot enter universe research list',()=>{
 assert.equal(normalizeKalshiMarket(market('KXBTC-26OCT26-B', {status:'closed'}),now),null);
 assert.equal(normalizeKalshiMarket(market('KXBTC-26OCT26-B',{close_time:new Date(now-1000).toISOString()}),now),null);
 assert.equal(normalizeKalshiMarket(market('KXBTC-26OCT26-B',{yes_ask_dollars:'0.0000',no_ask_dollars:'1.0000'}),now),null);
});
