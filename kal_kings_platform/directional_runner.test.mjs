import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDirectionalRunner} from './directional_runner.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const ticker='KXNFLGAME-26OCT26DALPHI-PHI';
const idea={id:'1',eventKey:'NFL:2026-10-26:DAL:PHI',strategy:'LATE_GAME_LEAD',
 market:{ticker,status:'active',yesAsk:.7,yesDepth:12,observedAt:new Date(now).toISOString(),closeTime:new Date(now+180000).toISOString()},
 probability:.91,sourceVerified:true,marketMatchVerified:true,lateGameVerified:true,
 game:{sport:'NFL',period:4,clockSeconds:60,homeScore:38,awayScore:16},
 updatedAt:new Date(now).toISOString()};
const book={orderbook_fp:{yes_dollars:[['0.6900','12.00']],no_dollars:[['0.3000','12.00']]}};
function fixture(override={}){
 let orders=[],rows=new Map(),requests=0;
 const sql=async(q,args=[])=>{
  if(q.includes('COUNT(*)')&&q.includes('kal_kings_directional_orders'))return [{n:'0'}];
  if(q.includes('INSERT INTO kal_kings_directional_orders')){if(rows.has(args[0]))return [];rows.set(args[0],{status:'SUBMITTING'});return [{ticker:args[0]}];}
  if(q.includes('UPDATE kal_kings_directional_orders'))return [];
  return [];
 };
 const deps={sql,fetchMarket:async requested=>({...idea.market,id:requested,ticker:requested,yesAsk:.7,yesDepth:12}),
  fetchOrderbook:async()=>book,
  fetchFeeSchedule:async()=>({feeType:'quadratic',feeMultiplier:1}),
  submit:async o=>{orders.push(o);return {order_id:'abc',fill_count:o.count};},
  now:()=>now,createId:()=> '123e4567-e89b-42d3-a456-426614174000',
  ...override};
 return {runner:makeDirectionalRunner(deps),orders,rows};
}
test('independently verified positive-value live leader may submit one bounded order',async()=>{
 const f=fixture();
 const r=await f.runner({ideas:[idea],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(r.status,'FILLED');assert.equal(f.orders.length,1);
 assert.equal(f.orders[0].ticker,ticker);assert.equal(f.orders[0].action,'buy');
 assert.equal(f.orders[0].side,'yes');assert.equal(f.orders[0].yes_price_dollars!==undefined,true);
});
test('unverified, stale, expensive, and unfunded plans never send orders',async()=>{
 const cases=[{...idea,sourceVerified:false},{...idea,updatedAt:new Date(now-30000).toISOString()},
 {...idea,game:{...idea.game,homeScore:17,awayScore:16}}];
 for(const x of cases){const f=fixture();const r=await f.runner({ideas:[x],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});assert.equal(f.orders.length,0);}
 const f=fixture();await f.runner({ideas:[idea],account:{balance:0,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(f.orders.length,0);
});
test('uncertain receipt never results in duplicate autonomous submission',async()=>{
 const f=fixture({submit:async()=>{throw Error('ambiguous network timeout')}});
 const account={balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'};
 const first=await f.runner({ideas:[idea],account});
 const second=await f.runner({ideas:[idea],account});
 assert.equal(first.status,'UNCERTAIN');assert.equal(second.status,'ALREADY_ATTEMPTED');
});

test('already-exceeded official game total can enter without historical model training',async()=>{
 const totalIdea={id:'total',strategy:'TOTAL_ALREADY_OVER',eventKey:'NFL:2026-10-26:DAL:PHI',
   updatedAt:new Date(now).toISOString(),sourceVerified:true,marketMatchVerified:true,
   market:{id:'KXNFLTOTAL-26OCT26DALPHI-44',ticker:'KXNFLTOTAL-26OCT26DALPHI-44'},
   game:{sport:'NFL',state:'in',homeScore:31,awayScore:17,homeAbbreviation:'PHI',awayAbbreviation:'DAL',
     date:'2026-10-26',updatedAt:new Date(now).toISOString()}};
 const b={orderbook_fp:{yes_dollars:[['0.8200','40.00']],no_dollars:[['0.1700','25.00']]}};
 const f=fixture({fetchMarket:async ticker=>({id:ticker,ticker,status:'active',
   floorStrike:44.5,rulesPrimary:'If Dallas and Philadelphia collectively score more than 44.5 points, then market resolves to Yes.',
   closeTime:new Date(now+180000).toISOString(),observedAt:new Date(now).toISOString()}),fetchOrderbook:async()=>b});
 const output=await f.runner({ideas:[totalIdea],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(output.status,'FILLED');
 assert.equal(f.orders.length,1);assert.equal(f.orders[0].ticker,totalIdea.market.ticker);
});

test('valid multiple-unit total order is not vetoed by unrelated two-percent risk rule',async()=>{
 const totalIdea={id:'total',strategy:'TOTAL_ALREADY_OVER',eventKey:'NFL:2026-10-26:DAL:PHI',
   updatedAt:new Date(now).toISOString(),sourceVerified:true,marketMatchVerified:true,
   market:{id:'KXNFLTOTAL-26OCT26DALPHI-44',ticker:'KXNFLTOTAL-26OCT26DALPHI-44'},
   game:{sport:'NFL',state:'in',homeScore:31,awayScore:17,homeAbbreviation:'PHI',awayAbbreviation:'DAL',
     date:'2026-10-26',updatedAt:new Date(now).toISOString()}};
 const b={orderbook_fp:{yes_dollars:[['0.8500','20.00']],no_dollars:[['0.1400','25.00']]}};
 const f=fixture({fetchMarket:async ticker=>({id:ticker,ticker,status:'active',
   floorStrike:44.5,rulesPrimary:'If Dallas and Philadelphia collectively score more than 44.5 points, then market resolves to Yes.',
   closeTime:new Date(now+180000).toISOString(),observedAt:new Date(now).toISOString()}),fetchOrderbook:async()=>b});
 const o=await f.runner({ideas:[totalIdea],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(o.status,'FILLED');
 assert.ok(o.contracts>1);
});

test('verified three-unit ninety-nine-cent total captures tiny positive aggregate margin',async()=>{
 const totalIdea={id:'tiny',strategy:'TOTAL_ALREADY_OVER',eventKey:'NFL:2026-10-26:DAL:PHI',
   updatedAt:new Date(now).toISOString(),sourceVerified:true,marketMatchVerified:true,
   market:{id:'KXNFLTOTAL-26OCT26DALPHI-44',ticker:'KXNFLTOTAL-26OCT26DALPHI-44'},
   game:{sport:'NFL',state:'in',homeScore:31,awayScore:17,
     homeAbbreviation:'PHI',awayAbbreviation:'DAL',date:'2026-10-26',
     updatedAt:new Date(now).toISOString()}};
 const orders={orderbook_fp:{yes_dollars:[['.9800','10.00']],no_dollars:[['.0100','20.00']]}};
 const f=fixture({fetchOrderbook:async()=>orders,
   fetchMarket:async ticker=>({id:ticker,ticker,status:'active',
     floorStrike:44.5,closeTime:new Date(now+180000).toISOString(),
     observedAt:new Date(now).toISOString(),
     rulesPrimary:'If Dallas and Philadelphia collectively score more than 44.5 points, then market resolves to Yes.'})});
 const out=await f.runner({ideas:[totalIdea],
   account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(out.status,'FILLED');
 assert.ok(out.contracts>=3);
 assert.ok(out.expectedNetDollars>0);
 assert.ok(out.estimatedMaxDebitDollars<=12.01);
 assert.equal(f.orders[0].count,Number(out.contracts).toFixed(2));
});
test('unknown Kalshi series fee structure cannot approve tiny apparent margin',async()=>{
 const f=fixture({fetchFeeSchedule:async()=>({feeType:'flat',feeMultiplier:null})});
 const out=await f.runner({ideas:[idea],account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(f.orders.length,0);
 assert.equal(out.reason,'FEE_SCHEDULE_UNVERIFIED');
});

test('a confirmed zero-fill on one market immediately tries another independently qualified market',async()=>{
 const second={...idea,id:'second',eventKey:'NFL:2026-10-26:TB:ATL',
    market:{...idea.market,ticker:'KXNFLGAME-26OCT26TBATL-ATL'}};
 let submissions=0;
 const f=fixture({submit:async order=>{
   f.orders.push(order);submissions++;
   return {order_id:'receipt-'+submissions,fill_count:submissions===1?'0.00':order.count};
 }});
 const out=await f.runner({ideas:[idea,second],
   account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(out.status,'FILLED');
 assert.equal(f.orders.length,2);
 assert.equal(f.orders[1].ticker,second.market.ticker);
});

test('crypto candidates are rejected and can never reach Kalshi order submission',async()=>{
 const candidate={...idea,strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',symbol:'ETH',
   market:{ticker:'KXETH15M-26OCT261215-15'},updatedAt:new Date(now).toISOString()};
 const f=fixture();
 const r=await f.runner({ideas:[candidate],account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(f.orders.length,0);
 assert.equal(r.reason,'UNSUPPORTED_STRATEGY');
});
test('confirmed zero-fill can be retried on a fresh quote after cooldown, never immediately',async()=>{
 let clock=now,tries=0,save=null;
 const records=new Map();
 const sql=async(q,a=[])=>{
  if(q.includes('SELECT ticker FROM kal_kings_directional_orders'))return [];
  if(q.includes('INSERT INTO kal_kings_directional_orders')){
   if(records.has(a[0]))return [];
   records.set(a[0],{status:'SUBMITTING',changed:clock});return [{ticker:a[0]}];
  }
  if(q.includes("SET status='SUBMITTING'")){
   const x=records.get(a[0]);
   if(!x||x.status!=='NOT_FILLED'||clock-x.changed<15000)return [];
   x.status='SUBMITTING';x.changed=clock;return [{ticker:a[0]}];
  }
  if(q.includes('UPDATE kal_kings_directional_orders')){
   const x=records.get(a[0]);x.status=a[1];x.changed=clock;return [];
  }
  return [];
 };
 const f=fixture({sql,now:()=>clock,createId:()=> '123e4567-e89b-42d3-a456-'+String(++tries).padStart(12,'0'),
  fetchMarket:async id=>({...idea.market,id,ticker:id,closeTime:new Date(clock+180000).toISOString(),observedAt:new Date(clock).toISOString()}),
  submit:async order=>{f.orders.push(order);return {order_id:'ok'+f.orders.length,fill_count:f.orders.length===1?'0.00':order.count}}});
 const account={balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'};
 const first=await f.runner({ideas:[idea],account});
 assert.equal(first.reason,'CONFIRMED_NO_FILL');
 assert.equal(f.orders.length,1);
 const second=await f.runner({ideas:[idea],account});
 assert.equal(second.status,'ALREADY_ATTEMPTED');assert.equal(f.orders.length,1);
 clock+=16000;
 const later=await f.runner({ideas:[{...idea,updatedAt:new Date(clock).toISOString()}],account});
 assert.equal(later.status,'FILLED');assert.equal(f.orders.length,2);
 assert.notEqual(f.orders[0].client_order_id,f.orders[1].client_order_id);
});

test('late-game leader qualifies by lead and clock even without 70 percent forecast',async()=>{
 const f=fixture({fetchOrderbook:async()=>({orderbook_fp:{
   yes_dollars:[['0.4000','12.00']],no_dollars:[['0.5500','12.00']]}})});
 const outcome=await f.runner({ideas:[{...idea,probability:.30}],
   account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(outcome.status,'FILLED');
 assert.equal(f.orders.length,1);
});

test('Kalshi explicitly rejecting an automatic sports/crypto order is not misreported as an uncertain fill',async()=>{
 const f=fixture({submit:async()=>{const e=new Error('Kalshi refuses write');e.httpStatus=403;throw e}});
 const result=await f.runner({ideas:[idea],
   account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(result.status,'REJECTED');
 assert.equal(result.reason,'KALSHI_ORDER_PERMISSION_DENIED');
});

test('fresh exchange top-of-book fallback turns an empty orderbook into a bounded sports execution attempt',async()=>{
 const fallbackTicker='KXNHLGAME-26OCT27LAKNYR-NYR';
 const fallbackIdea={...idea,market:{...idea.market,ticker:fallbackTicker},
   eventKey:'NHL:2026-10-27:LAK:NYR',updatedAt:new Date(now).toISOString(),
   game:{sport:'NHL',period:3,clockSeconds:240,homeScore:1,awayScore:4}};
 const f=fixture({fetchMarket:async requested=>({id:requested,ticker:requested,status:'active',
   yesAsk:.76,noAsk:.25,yesDepth:8,noDepth:5,
   closeTime:new Date(now+180000).toISOString(),observedAt:new Date(now).toISOString(),
   floorStrike:null,rulesPrimary:'Official NHL winner market'}),
   fetchOrderbook:async()=>({orderbook_fp:{yes_dollars:[],no_dollars:[]}})});
 const out=await f.runner({ideas:[fallbackIdea],
   account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(f.orders.length,1);
 assert.equal(f.orders[0].ticker,fallbackTicker);
 assert.equal(out.status,'FILLED');
});
test('empty orderbook with stale or depth-free quote remains blocked',async()=>{
 const fallbackTicker='KXNHLGAME-26OCT27LAKNYR-NYR';
 const candidate={...idea,market:{...idea.market,ticker:fallbackTicker},
   eventKey:'NHL:2026-10-27:LAK:NYR',updatedAt:new Date(now).toISOString(),
   game:{sport:'NHL',period:3,clockSeconds:240,homeScore:1,awayScore:4}};
 for(const bad of [
   {yesAsk:.76,yesDepth:8,observedAt:new Date(now-5000).toISOString()},
   {yesAsk:.76,yesDepth:0,observedAt:new Date(now).toISOString()}
 ]){
  const f=fixture({fetchMarket:async requested=>({id:requested,ticker:requested,status:'active',
    ...bad,closeTime:new Date(now+180000).toISOString()}),
    fetchOrderbook:async()=>({orderbook_fp:{yes_dollars:[],no_dollars:[]}})});
  await f.runner({ideas:[candidate],account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
  assert.equal(f.orders.length,0);
 }
});

test('100-cent leader quote with zero displayed ask size is explicitly blocked rather than falsely counted as an order attempt',async()=>{
 const blockedTicker='KXNBAGAME-26OCT26ATLHOU-HOU';
 const f=fixture({fetchMarket:async requested=>({id:requested,ticker:requested,status:'active',
   yesAsk:1,noAsk:.01,yesDepth:0,noDepth:0,
   closeTime:new Date(now+180000).toISOString(),observedAt:new Date(now).toISOString()}),
   fetchOrderbook:async()=>({orderbook_fp:{yes_dollars:[],no_dollars:[]}})});
 const out=await f.runner({ideas:[{...idea,market:{...idea.market,ticker:blockedTicker}}],
   account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(f.orders.length,0);
 assert.equal(out.reason,'ASK_PRICE_INVALID_OR_AT_BOUNDARY_AND_NO_DISPLAYED_ASK_SIZE');
});
