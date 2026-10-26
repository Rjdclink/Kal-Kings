/** Read-only dashboard view of verified Kalshi holdings and settlements.
 * No local credit or expected profit is added to exchange available cash. */
const numeric=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const validTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
export function settlementDashboardState({account=null,settlements=null,asOf=new Date().toISOString()}={}){
 const readable=account?.status==='VERIFIED'&&Array.isArray(account?.holdings);
 const feed=Array.isArray(settlements);
 const settled=(feed?settlements:[]).filter(x=>x?.ticker&&validTime(x?.settled_time)&&
  ['yes','no','void','scalar'].includes(x.market_result)).sort((a,b)=>Date.parse(b.settled_time)-Date.parse(a.settled_time));
 const mostRecent=new Map();
 for(const record of settled)if(!mostRecent.has(record.ticker))mostRecent.set(record.ticker,Date.parse(record.settled_time));
 const pending=readable?account.holdings
  .filter(x=>x?.ticker&&numeric(x.position)!==null&&numeric(x.position)!==0)
  .filter(x=>{
   const date=mostRecent.get(x.ticker);
   return date===undefined||(validTime(x.updatedAt)&&Date.parse(x.updatedAt)>date);
  }).map(x=>({ticker:x.ticker,side:Number(x.position)>0?'YES':'NO',contracts:Math.abs(Number(x.position)),
    marketExposureDollars:numeric(x.marketExposure),updatedAt:x.updatedAt||null,
    status:'AWAITING_SETTLEMENT'})):[];
 const recentSettlements=settled.slice(0,10).map(x=>({ticker:x.ticker,
   marketResult:x.market_result.toUpperCase(),settledAt:x.settled_time,
   payoutDollars:Number.isInteger(Number(x.revenue))?Number(x.revenue)/100:null}));
 return {status:readable?(account.positionsComplete?'VERIFIED':'PARTIAL'):'UNAVAILABLE',
  settlementsStatus:feed?'VERIFIED':'UNAVAILABLE',checkedAt:asOf,
  availableBalanceDollars:readable?numeric(account.balance):null,
  pendingCount:readable?pending.length:null,
  pendingContracts:readable?pending.reduce((t,x)=>t+x.contracts,0):null,
  pending,recentSettlements,latestSettlementPayoutDollars:recentSettlements[0]?.payoutDollars??null};
}