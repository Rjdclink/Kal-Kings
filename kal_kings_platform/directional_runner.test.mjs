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
 const deps={sql,fetchMarket:async()=>({id:ticker,...idea.market,yesAsk:.7,yesDepth:12}),
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
 {...idea,probability:.80}];
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
