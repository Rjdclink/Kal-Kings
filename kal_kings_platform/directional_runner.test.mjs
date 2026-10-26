import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDirectionalRunner} from './directional_runner.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const ticker='KXNFLGAME-26OCT26DALPHI-PHI';
const idea={id:'1',eventKey:'NFL:2026-10-26:DAL:PHI',strategy:'LATE_GAME_LEAD',
 market:{ticker,status:'active',yesAsk:.7,yesDepth:12,observedAt:new Date(now).toISOString(),closeTime:new Date(now+180000).toISOString()},
 probability:.91,sourceVerified:true,marketMatchVerified:true,modelPlayId:'p56',updatedAt:new Date(now).toISOString()};
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
 assert.equal(f.orders[0].ticker,ticker);assert.equal(f.orders[0].side,'bid');
});
test('unverified, stale, expensive, and unfunded plans never send orders',async()=>{
 const cases=[{...idea,sourceVerified:false},{...idea,updatedAt:new Date(now-30000).toISOString()},
 {...idea,probability:.60}];
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
 assert.equal(out.contracts,3);
 assert.ok(out.expectedNetDollars>0);
 assert.equal(f.orders[0].count,'3.00');
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
   return {order_id:'receipt-'+submissions,fill_count:submissions===1?'0.00':'1.00'};
 }});
 const out=await f.runner({ideas:[idea,second],
   account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(out.status,'FILLED');
 assert.equal(f.orders.length,2);
 assert.equal(f.orders[1].ticker,second.market.ticker);
});

test('verified crypto DOWN uses an exchange NO purchase after fresh five-source agreement',async()=>{
 const ticker='KXBTC15M-26OCT261215-15';
 const candidate={...idea,strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',symbol:'BTC',side:'no',
  market:{ticker},probability:.94,modeledWinProbability:.94,
  agreeingSources:5,allocationFraction:.2,
  model:{status:'ESTIMATED',trials:2500,observedAt:new Date(now-10000).toISOString()},
  updatedAt:new Date(now-10000).toISOString()};
 const f=fixture({fetchMarket:async id=>({id,ticker:id,status:'active',
   rulesPrimary:"If the simple average of CF Benchmarks BRTI before 12:15 is at least the preceding average, the market resolves to Yes.",
   closeTime:new Date(now+300000).toISOString(),observedAt:new Date(now).toISOString()}),
   fetchFinalConsensus:async()=>({direction:'DOWN',agreeingSources:5,allocationFraction:.2,
      marketTicker:ticker,updatedAt:new Date(now).toISOString()})});
 const r=await f.runner({ideas:[candidate],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(r.status,'FILLED');assert.equal(f.orders[0].side,'ask');
 assert.equal(f.orders[0].price,'0.6900');assert.ok(r.contracts>1);
});
test('changed consensus during final refresh stops crypto execution',async()=>{
 const ticker='KXBTC15M-26OCT261215-15';
 const candidate={...idea,strategy:'CRYPTO_DIRECTIONAL_CONSENSUS',symbol:'BTC',side:'no',
   market:{ticker},probability:.94,agreeingSources:5,allocationFraction:.2,
   model:{status:'ESTIMATED',trials:2500,observedAt:new Date(now-20000).toISOString()},
   updatedAt:new Date(now-20000).toISOString()};
 const f=fixture({fetchFinalConsensus:async()=>({direction:'UP',agreeingSources:7,allocationFraction:.4,marketTicker:ticker,updatedAt:new Date(now).toISOString()})});
 const r=await f.runner({ideas:[candidate],account:{balance:15,holdings:[],positionsComplete:true,status:'VERIFIED'}});
 assert.equal(r.status,'NO_VERIFIED_DIRECTIONAL_EDGE');assert.equal(f.orders.length,0);
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

test('70 to 85 percent forecast may auto-buy commanding late leader when net price edge is positive',async()=>{
 const f=fixture({fetchOrderbook:async()=>({orderbook_fp:{
   yes_dollars:[['0.4000','12.00']],no_dollars:[['0.5500','12.00']]}})});
 const outcome=await f.runner({ideas:[{...idea,probability:.78}],
   account:{status:'VERIFIED',balance:15,holdings:[],positionsComplete:true}});
 assert.equal(outcome.status,'FILLED');
 assert.equal(f.orders.length,1);
});
