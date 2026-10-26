import {scanUniversePage} from './market_universe.mjs';
export function makeUniverseScanner({sql,fetcher,now=Date.now,limit=500}){
 if(typeof sql!=='function'||typeof fetcher!=='function')throw Error('Missing services');
 async function scan(){
  const recent=await sql('SELECT next_cursor FROM kal_kings_universe_scans ORDER BY scanned_at DESC LIMIT 1');
  const cursor=recent?.[0]?.next_cursor||'';
  const result=await scanUniversePage({fetcher,cursor,now:now(),limit});
  await sql(`INSERT INTO kal_kings_universe_scans
    (scanned_count,eligible_count,category_counts,sample,next_cursor,completed_sweep)
    VALUES($1::integer,$2::integer,$3::jsonb,$4::jsonb,$5,$6::boolean)`,
    [result.scanned,result.eligibleQuoted,JSON.stringify(result.byCategory),
     JSON.stringify(result.research),result.nextCursor,result.completedSweep]);
  return {scanned:result.scanned,eligibleQuoted:result.eligibleQuoted,
   byCategory:result.byCategory,research:result.research,
   completedSweep:result.completedSweep,asOf:result.asOf};
 }
 async function latest(){
  const rows=await sql(`SELECT scanned_count,eligible_count,category_counts::text AS counts,
    sample::text AS sample,completed_sweep,scanned_at
    FROM kal_kings_universe_scans ORDER BY scanned_at DESC LIMIT 1`);
  const r=rows?.[0];if(!r)return{scanned:0,eligibleQuoted:0,byCategory:{},research:[],status:'NOT_YET_SCANNED'};
  return {scanned:Number(r.scanned_count),eligibleQuoted:Number(r.eligible_count),
    byCategory:typeof r.counts==='string'?JSON.parse(r.counts):r.counts,
    research:typeof r.sample==='string'?JSON.parse(r.sample):r.sample,
    completedSweep:r.completed_sweep,asOf:r.scanned_at,status:'ROLLING_PUBLIC_MARKET_SCAN',
    note:'One rotating page per cycle. No identified market is profitable without independent edge verification.'};
 }
 return{scan,latest};
}
