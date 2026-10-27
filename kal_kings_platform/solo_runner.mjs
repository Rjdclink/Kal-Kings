/** Independent Kalshi intramarket automation. No DraftKings dependencies.
 * One opportunity per market ticker, at most one candidate per scheduled run.
 * If either FOK leg is ambiguous/partial, disable subsequent automated orders
 * until reconciliation to avoid compounding an uncovered exposure.
 */

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
    let scanMeta={sportsSignals:0,universeScanned:0,ideaCount:0,directionalReason:null,sportsExecutionStatus:null,sportsExecutionReason:null,executionCandidateChecks:0,orderSubmissionAttempts:0,lastCheckedTicker:null,lastCheckedStrategy:null,totalProofDiagnostics:null,priorityOrder:['TOTAL_ALREADY_OVER','LATE_GAME_LEAD']};
    let leaseAcquired=false;
    const finish=async result=>{
      try{
        await sql('UPDATE kal_kings_solo_runs SET result=$2,finished_at=now() WHERE invocation_id=$1',[invocationId,result.status]);
        try{await recordScan({...scanMeta,...result,stage})}catch{/* Diagnostics must not prevent future scans. */}
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
      // Run the sports-only signal scan after account and exposure reconciliation.
      let predictive={ideas:[]};
      try{predictive=await scanPredictive()}catch{/* Never let an advisory feed cause blind orders or stop cash reconciliation. */}
      scanMeta={...scanMeta,sportsSignals:Number(predictive?.sportsSignals)||0,universeScanned:Number(predictive?.universeScanned)||0,
        ideaCount:Array.isArray(predictive?.ideas)?predictive.ideas.length:0,
        totalProofDiagnostics:predictive?.totalProofDiagnostics||null,
        priorityOrder:predictive?.priorityOrder||['TOTAL_ALREADY_OVER','LATE_GAME_LEAD']};
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
      const ideas=Array.isArray(predictive?.ideas)?predictive.ideas:[];
      // Only verified sports candidates are permitted into the order runner.
      const sportsIdeas=ideas.filter(x=>['TOTAL_ALREADY_OVER','LATE_GAME_LEAD'].includes(x?.strategy));
      if(sportsIdeas.length){
        stage='SPORTS_EXECUTION';
        const sport=await executeDirectional({ideas:sportsIdeas,account:{status:'VERIFIED',balance,
          holdings:account?.holdings,positionsComplete:account?.positionsComplete}});
        scanMeta.directionalReason=sport?.reason||sport?.status||'SPORTS_NOT_APPROVED';
        scanMeta.sportsExecutionStatus=sport?.status||'UNAVAILABLE';
        scanMeta.sportsExecutionReason=sport?.reason||null;
        scanMeta.executionCandidateChecks+=Number(sport?.candidateChecks)||0;
        scanMeta.orderSubmissionAttempts+=Number(sport?.orderSubmissionAttempts)||0;
        scanMeta.lastCheckedTicker=sport?.lastCheckedTicker||scanMeta.lastCheckedTicker;
        scanMeta.lastCheckedStrategy=sport?.lastCheckedStrategy||scanMeta.lastCheckedStrategy;
        if(['FILLED','PARTIALLY_FILLED','UNCERTAIN'].includes(sport?.status))
          return finish({status:'SPORTS_'+sport.status,ticker:sport.ticker});
        if(sport?.status==='REJECTED')
          return finish({status:'SPORTS_REJECTED',reason:sport.reason,ticker:sport.ticker});
        if(sport?.status==='HALTED_PENDING_RECONCILIATION')
          return finish({status:'HALTED_DIRECTIONAL_RECONCILIATION'});
      }
      if(!sportsIdeas.length&&!scanMeta.directionalReason)scanMeta.directionalReason='NO_VERIFIED_MATCHED_SPORTS_CANDIDATE';
      if(scanMeta.sportsSignals>0){
        const status=scanMeta.orderSubmissionAttempts>0?'SPORTS_EXECUTION_ATTEMPTED_NO_FILL':
          scanMeta.ideaCount>0?'SPORTS_SIGNALS_FOUND_NO_EXECUTABLE_ORDER':
          'SPORTS_SIGNALS_FOUND_NO_EXECUTION_CANDIDATE';
        return finish({status,reason:scanMeta.sportsExecutionReason||scanMeta.directionalReason||
          (scanMeta.ideaCount>0?'SPORTS_CANDIDATES_REJECTED_BY_LIVE_EXECUTION_GATES':'NO_VERIFIED_MATCHED_SPORTS_CANDIDATE')});
      }
      return finish({status:'NO_LIVE_SPORTS_CANDIDATES',reason:scanMeta.directionalReason});
    }catch{
      return finish({status:`SCANNER_UNAVAILABLE_${stage}`});
    }
  };
}
