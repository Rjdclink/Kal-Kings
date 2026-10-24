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
export function isNeonSoloTrigger(headers,body,now=Date.now()){
  const invoke=headers?.['x-neon-trigger-invocation-id'];
  const scheduled=Date.parse(body?.data?.scheduled_at||'');
  return typeof invoke==='string'&&invoke.length>0&&invoke===body?.invocation_id&&
    body?.version===1&&body?.trigger?.type==='schedule'&&body.trigger.name==='kal-kings-solo-minute'&&
    Number.isFinite(scheduled)&&Math.abs(now-scheduled)<=120000;
}
export function makeSoloRunner({fetchAccount,fetchQuotes,fetchMarket,sql,submit,createId,monitorPositions=async()=>({}),now=Date.now}){
  return async ({invocationId,scheduledAt})=>{
    // Database idempotence also protects against webhook redelivery.
    const lock=await sql('INSERT INTO kal_kings_solo_runs(invocation_id,scheduled_at) VALUES($1,$2::timestamptz) ON CONFLICT DO NOTHING RETURNING invocation_id',[invocationId,scheduledAt]);
    if(!lock.length)return {status:'DUPLICATE_RUN'};
    const finish=async result=>{
      await sql('UPDATE kal_kings_solo_runs SET result=$2,finished_at=now() WHERE invocation_id=$1',[invocationId,result.status]);
      return result;
    };
    let stage='MONITOR';
    try{
      // Reconcile bot positions and inspect exchange-held cash before seeking new
      // entries. Settlement notices are NOT manually credited to bankroll.
      const monitored=await monitorPositions();
      if(Number(monitored?.pendingReview)>0)return finish({status:'HALTED_PENDING_RECONCILIATION'});
      stage='EXPOSURES';
      const exposures=await sql(`SELECT o.ticker FROM kal_kings_solo_orders o
        LEFT JOIN kal_kings_position_watch w ON o.ticker=w.ticker
        WHERE o.status IN ('UNHEDGED','UNCERTAIN','PARTIALLY_FILLED','YES_FILLED','SUBMITTING')
          AND (w.status IS NULL OR w.status<>'CLOSED') LIMIT 1`);
      if(exposures.length)return finish({status:'HALTED_PENDING_RECONCILIATION'});
      stage='ACCOUNT';
      if(monitored?.status==='ACCOUNT_UNAVAILABLE')return finish({status:'ACCOUNT_UNAVAILABLE'});
      const verifiedCash=Number(monitored?.freeCash);
      // Lifecycle already performed a signed balance read. Reuse that verified
      // balance rather than issuing a second request every minute, which can
      // trigger provider rate limits and leave the worker unable to scan.
      const hasMonitoredCash=monitored?.status==='MONITORED' && Number.isFinite(verifiedCash) && verifiedCash>=0;
      const balance=hasMonitoredCash?verifiedCash:Number((await fetchAccount())?.balance);
      if(!Number.isFinite(balance)||balance<=0)return finish({status:'UNFUNDED'});
      stage='QUOTES';
      const candidates=findKalshiSoloCandidates(await fetchQuotes(),{balance,now:now()});
      if(!candidates.length)return finish({status:'NO_QUALIFYING_KALSHI_TRADE'});
      for(const idea of candidates){
        // Requery the exact market immediately before submitting. The scanner
        // does not treat a 3-second UI refresh as proof of execution freshness.
        stage='REQUOTE';
        const exact=await fetchMarket(idea.marketTicker);
        const refreshed=findKalshiSoloCandidates([exact],{balance,now:now()})[0];
        if(!refreshed)continue;
        const firstId=createId(),secondId=createId();
        stage='RESERVATION';
        const created=await sql(`INSERT INTO kal_kings_solo_orders(ticker,status,yes_client_order_id,no_client_order_id,contracts,yes_price,no_price,net_profit_dollars,capital_reserved_dollars,created_at)
          VALUES($1,'SUBMITTING',$2::uuid,$3::uuid,$4,$5,$6,$7,$8,now()) ON CONFLICT(ticker) DO NOTHING RETURNING ticker`,
          [refreshed.marketTicker,firstId,secondId,String(refreshed.count),String(refreshed.yesPrice),String(refreshed.noPrice),String(refreshed.netProfitDollars),String(refreshed.requiredDollars)]);
        if(!created.length)continue;
        const [yes,no]=kalshiSoloLegs(refreshed,[firstId,secondId]);
        let yesFill=0,noFill=0;
        try{
          const response=await submit(yes);
          const yesStatus=statusFromFill(response,refreshed.count);
          yesFill=Number(response?.fill_count)||0;
          await sql('UPDATE kal_kings_solo_orders SET yes_filled=$2,yes_order_id=$3,status=$4,updated_at=now() WHERE ticker=$1',
            [refreshed.marketTicker,String(yesFill),String(response.order_id||'').slice(0,128)||null,yesStatus==='FILLED'?'YES_FILLED':yesStatus]);
          if(yesStatus==='NOT_FILLED')return finish({status:'NOT_FILLED'});
          if(yesStatus!=='FILLED')return finish({status:'UNCERTAIN'});
          const opposite=await submit(no);
          const noStatus=statusFromFill(opposite,refreshed.count);
          noFill=Number(opposite?.fill_count)||0;
          const finalStatus=noStatus==='FILLED'?'HEDGED':noStatus==='NOT_FILLED'?'UNHEDGED':'UNCERTAIN';
          await sql('UPDATE kal_kings_solo_orders SET no_filled=$2,no_order_id=$3,status=$4,updated_at=now() WHERE ticker=$1',
            [refreshed.marketTicker,String(noFill),String(opposite.order_id||'').slice(0,128)||null,finalStatus]);
          return finish({status:finalStatus,marketTicker:refreshed.marketTicker,yesFilled:yesFill,noFilled:noFill,projectedNetProfitDollars:refreshed.netProfitDollars});
        }catch{
          // A timeout can occur after execution. Never retry blindly.
          const state=yesFill>0?'UNHEDGED':'UNCERTAIN';
          await sql('UPDATE kal_kings_solo_orders SET status=$2,updated_at=now() WHERE ticker=$1',[refreshed.marketTicker,state]);
          return finish({status:state,marketTicker:refreshed.marketTicker});
        }
      }
      return finish({status:'NO_NEW_KALSHI_MARKET_ELIGIBLE'});
    }catch{
      return finish({status:`SCANNER_UNAVAILABLE_${stage}`});
    }
  };
}
