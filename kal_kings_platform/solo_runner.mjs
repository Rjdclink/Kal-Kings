/** Independent Kalshi intramarket automation. No DraftKings dependencies.
 * One opportunity per market ticker, at most one candidate per scheduled run.
 * If either FOK leg is ambiguous/partial, disable subsequent automated orders
 * until reconciliation to avoid compounding an uncovered exposure.
 */
import {findKalshiSoloCandidates,kalshiSoloLegs} from './kalshi_solo.mjs';
const statusFromFill=(r,count)=>{
  const n=Number(r?.fill_count);
  if(!Number.isFinite(n)||n<0||n>count)return 'UNCERTAIN';
  if(n===0)return 'NOT_FILLED';
  return n>=count?'FILLED':'PARTIALLY_FILLED';
};
/** Stable five-second slot across authenticated dashboard tabs and sessions.
 * The unique DB invocation lock is shared with the minute scheduler.
 */
export function activeScanSlot(now=Date.now()){
 if(!Number.isFinite(now)||now<0)throw RangeError('Invalid scan clock');
 const slot=Math.floor(now/5000)*5000;
 return {invocationId:'dashboard-5s-'+slot,
   scheduledAt:new Date(slot).toISOString()};
}
export function isNeonSoloTrigger(headers,body,now=Date.now()){
  const invoke=headers?.['x-neon-trigger-invocation-id'];
  const scheduled=Date.parse(body?.data?.scheduled_at||'');
  return typeof invoke==='string'&&invoke.length>0&&invoke===body?.invocation_id&&
    body?.version===1&&body?.trigger?.type==='schedule'&&body.trigger.name==='kal-kings-solo-minute'&&
    Number.isFinite(scheduled)&&Math.abs(now-scheduled)<=120000;
}
export function makeSoloRunner({fetchAccount,fetchQuotes,fetchMarket,sql,submit,createId,quantRiskGate,monitorPositions=async()=>({}),recordSnapshots=async()=>{},scanPredictive=async()=>({ideas:[]}),monitorDirectional=async()=>({pendingReview:0}),executeDirectional=async()=>({status:'NO_VERIFIED_DIRECTIONAL_EDGE'}),recordScan=async()=>{},
 acquireScanLease=async()=>true,releaseScanLease=async()=>{},now=Date.now}){
  return async ({invocationId,scheduledAt})=>{
    // Database idempotence also protects against webhook redelivery.
    const lock=await sql('INSERT INTO kal_kings_solo_runs(invocation_id,scheduled_at) VALUES($1,$2::timestamptz) ON CONFLICT DO NOTHING RETURNING invocation_id',[invocationId,scheduledAt]);
    if(!lock.length)return {status:'DUPLICATE_RUN'};
    let scanMeta={cryptoSignals:0,sportsSignals:0,universeScanned:0,ideaCount:0,directionalReason:null};
    let leaseAcquired=false;
    const finish=async result=>{
      try{
        await sql('UPDATE kal_kings_solo_runs SET result=$2,finished_at=now() WHERE invocation_id=$1',[invocationId,result.status]);
        try{await recordScan({...scanMeta,...result})}catch{/* Diagnostics must not prevent future scans. */}
      }finally{
        if(leaseAcquired)try{await releaseScanLease(invocationId)}catch{/* Lease expires automatically. */}
      }
      return result;
    };
    let stage='LEASE';
    try{
      leaseAcquired=await acquireScanLease(invocationId);
      if(!leaseAcquired)return finish({status:'SCANNER_BUSY'});
      stage='MONITOR';
      // Reconcile bot positions and inspect exchange-held cash before seeking new
      // entries. Settlement notices are NOT manually credited to bankroll.
      const monitored=await monitorPositions();
      const directionalPositions=await monitorDirectional(monitored);
      if(Number(directionalPositions?.pendingReview)>0)return finish({status:'HALTED_DIRECTIONAL_RECONCILIATION'});
      if(Number(monitored?.pendingReview)>0)return finish({status:'HALTED_PENDING_RECONCILIATION'});
      stage='EXPOSURES';
      const exposures=await sql(`SELECT o.ticker FROM kal_kings_solo_orders o
        LEFT JOIN kal_kings_position_watch w ON o.ticker=w.ticker
        WHERE o.status IN ('UNHEDGED','UNCERTAIN','PARTIALLY_FILLED','YES_FILLED','SUBMITTING')
          AND (w.status IS NULL OR w.status<>'CLOSED') LIMIT 1`);
      if(exposures.length)return finish({status:'HALTED_PENDING_RECONCILIATION'});
      // Independent directional, late-game and totals watchlist runs even when
      // the existing paired YES/NO engine has no viable opportunity.
      let predictive={ideas:[]};
      try{predictive=await scanPredictive()}catch{/* Never let an advisory feed cause blind orders or stop cash reconciliation. */}
      scanMeta={...scanMeta,cryptoSignals:Number(predictive?.cryptoSignals)||0,
        sportsSignals:Number(predictive?.sportsSignals)||0,universeScanned:Number(predictive?.universeScanned)||0,
        ideaCount:Array.isArray(predictive?.ideas)?predictive.ideas.length:0};
      stage='ACCOUNT';
      if(monitored?.status==='ACCOUNT_UNAVAILABLE')return finish({status:'ACCOUNT_UNAVAILABLE'});
      const verifiedCash=Number(monitored?.freeCash);
      // Lifecycle already performed a signed balance read. Reuse that verified
      // balance rather than issuing a second request every minute, which can
      // trigger provider rate limits and leave the worker unable to scan.
      const hasMonitoredCash=monitored?.status==='MONITORED' && Number.isFinite(verifiedCash) && verifiedCash>=0;
      const account=hasMonitoredCash?monitored:await fetchAccount();
      const balance=hasMonitoredCash?verifiedCash:Number(account?.balance);
      if(!Number.isFinite(balance)||balance<=0){
        // Preserve public quote histories when no cash is available; no
        // simulated wins or unattended orders are credited.
        try{
          const quotes=await fetchQuotes();
          if(Array.isArray(quotes)&&quotes.length)await recordSnapshots(quotes);
        }catch{/* Unfunded account must not turn provider outages into orders. */}
        return finish({status:'UNFUNDED'});
      }
      if(Array.isArray(predictive?.ideas)&&predictive.ideas.length){
        stage='DIRECTIONAL';
        const dir=await executeDirectional({ideas:predictive.ideas,
          account:{status:'VERIFIED',balance,holdings:account?.holdings,
            positionsComplete:account?.positionsComplete}});
        scanMeta.directionalReason=dir?.reason||dir?.status||'NOT_APPROVED';
        if(['FILLED','PARTIALLY_FILLED','UNCERTAIN'].includes(dir?.status))
          return finish({status:'DIRECTIONAL_'+dir.status,ticker:dir.ticker});
        if(dir?.status==='REJECTED')return finish({status:'DIRECTIONAL_REJECTED',reason:dir.reason,ticker:dir.ticker});
        if(dir?.status==='HALTED_PENDING_RECONCILIATION')
          return finish({status:'HALTED_DIRECTIONAL_RECONCILIATION'});
      }
      if(!scanMeta.ideaCount&&!scanMeta.directionalReason)scanMeta.directionalReason='NO_VERIFIED_DIRECTIONAL_CANDIDATES';
      // Preserve bounded real quote histories independently of bank funding.
      // No-fill and no-funds cycles must not count toward profitable trades.
      stage='QUOTE_HISTORY';
      // The old eight-series YES/NO scanner is OPTIONAL for the independent
      // directional engine. Its outage cannot block a separately verified
      // late-game or already-crossed total opportunity.
      let currentQuotes=[];
      try{
        const legacy=await fetchQuotes();
        if(Array.isArray(legacy))currentQuotes=legacy;
      }catch{/* No legacy quotes; other venue data may still be available. */}
      if(currentQuotes.length){
        try{await recordSnapshots(currentQuotes)}
        catch{/* Missing history is not permission to bypass the live risk gate. */}
      }
      scanMeta.legacyQuoteCount=currentQuotes.length;
      if(!currentQuotes.length)return finish({status:'NO_VALID_LEGACY_QUOTES',
        reason:'LEGACY_SPORTS_QUOTES_UNAVAILABLE'});
      stage='QUOTES';
      const candidates=findKalshiSoloCandidates(currentQuotes,{balance,now:now()});
      if(!candidates.length)return finish({status:'NO_QUALIFYING_KALSHI_TRADE',reason:'NO_POSITIVE_YES_NO_SPREAD_AFTER_FEES'});
      for(const idea of candidates){
        // Requery the exact market immediately before submitting. The scanner
        // does not treat a 3-second UI refresh as proof of execution freshness.
        stage='REQUOTE';
        const exact=await fetchMarket(idea.marketTicker);
        const refreshed=findKalshiSoloCandidates([exact],{balance,now:now()})[0];
        if(!refreshed)continue;
        // Independent order-book, historical fill, and portfolio-risk decision.
        // Missing, invalid, or inconclusive quantitative evidence cannot
        // silently fall back to the indicative quote-based order size.
        stage='QUANT_RISK';
        let risk;
        try{
          risk=typeof quantRiskGate==='function'
            ? await quantRiskGate({quote:exact,balance,holdings:account?.holdings,
                positionsComplete:account?.positionsComplete,now:now()})
            :{accepted:false,reason:'RISK_ENGINE_UNAVAILABLE'};
        }catch{risk={accepted:false,reason:'RISK_ENGINE_UNAVAILABLE'};}
        if(!risk?.accepted||!risk.candidate)continue;
        const selected=risk.candidate;
        if(selected.marketTicker!==refreshed.marketTicker||selected.source!=='KALSHI_ONLY'||
           !Number.isInteger(selected.count)||selected.count<1)continue;
        const firstId=createId(),secondId=createId();
        stage='RESERVATION';
        const created=await sql(`INSERT INTO kal_kings_solo_orders(ticker,status,yes_client_order_id,no_client_order_id,contracts,yes_price,no_price,net_profit_dollars,capital_reserved_dollars,created_at)
          VALUES($1,'SUBMITTING',$2::uuid,$3::uuid,$4,$5,$6,$7,$8,now()) ON CONFLICT(ticker) DO NOTHING RETURNING ticker`,
          [selected.marketTicker,firstId,secondId,String(selected.count),String(selected.yesPrice),String(selected.noPrice),String(selected.netProfitDollars),String(selected.requiredDollars)]);
        if(!created.length)continue;
        const [yes,no]=kalshiSoloLegs(selected,[firstId,secondId]);
        let yesFill=0,noFill=0;
        try{
          const response=await submit(yes);
          const yesStatus=statusFromFill(response,selected.count);
          yesFill=Number(response?.fill_count)||0;
          await sql('UPDATE kal_kings_solo_orders SET yes_filled=$2,yes_order_id=$3,status=$4,updated_at=now() WHERE ticker=$1',
            [selected.marketTicker,String(yesFill),String(response.order_id||'').slice(0,128)||null,yesStatus==='FILLED'?'YES_FILLED':yesStatus]);
          if(yesStatus==='NOT_FILLED')return finish({status:'NOT_FILLED'});
          if(yesStatus!=='FILLED')return finish({status:'UNCERTAIN'});
          const opposite=await submit(no);
          const noStatus=statusFromFill(opposite,selected.count);
          noFill=Number(opposite?.fill_count)||0;
          const finalStatus=noStatus==='FILLED'?'HEDGED':noStatus==='NOT_FILLED'?'UNHEDGED':'UNCERTAIN';
          await sql('UPDATE kal_kings_solo_orders SET no_filled=$2,no_order_id=$3,status=$4,updated_at=now() WHERE ticker=$1',
            [selected.marketTicker,String(noFill),String(opposite.order_id||'').slice(0,128)||null,finalStatus]);
          return finish({status:finalStatus,marketTicker:selected.marketTicker,yesFilled:yesFill,noFilled:noFill,projectedNetProfitDollars:selected.netProfitDollars});
        }catch{
          // A timeout can occur after execution. Never retry blindly.
          const state=yesFill>0?'UNHEDGED':'UNCERTAIN';
          await sql('UPDATE kal_kings_solo_orders SET status=$2,updated_at=now() WHERE ticker=$1',[selected.marketTicker,state]);
          return finish({status:state,marketTicker:selected.marketTicker});
        }
      }
      return finish({status:'NO_QUANT_APPROVED_KALSHI_TRADE'});
    }catch{
      return finish({status:`SCANNER_UNAVAILABLE_${stage}`});
    }
  };
}
