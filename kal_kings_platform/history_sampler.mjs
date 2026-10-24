/** Bounded long-lived market observation sample: current, diverse and exact. */
const ok=(v)=>typeof v==='number'&&Number.isFinite(v);
export function selectHistorySamples(quotes,now=Date.now(),max=12){
 if(!Array.isArray(quotes)||!ok(now)||!Number.isInteger(max)||max<1||max>20)return [];
 const seen=new Set(),eligible=[];
 for(const q of quotes){
  if(!q||typeof q.id!=='string'||!/^[A-Z0-9_-]{4,128}$/.test(q.id)||seen.has(q.id))continue;
  const age=now-Date.parse(q.observedAt||'');
  if(!ok(age)||age<0||age>3000)continue;
  if(![q.yesBid,q.yesAsk,q.yesDepth,q.noDepth].every(ok))continue;
  if(q.yesBid<=0||q.yesAsk>=1||q.yesBid>=q.yesAsk||q.yesDepth<0||q.noDepth<0)continue;
  seen.add(q.id);eligible.push(q);
 }
 eligible.sort((a,b)=>(b.yesDepth+b.noDepth)-(a.yesDepth+a.noDepth)||a.id.localeCompare(b.id));
 const primaryCount=Math.min(max,Math.ceil(max*.67)),chosen=eligible.slice(0,primaryCount),rest=eligible.slice(primaryCount);
 if(!rest.length)return chosen;
 const start=(Math.floor(now/60000)*Math.max(1,max-primaryCount))%rest.length;
 const slots=Math.min(max-chosen.length,rest.length);
 for(let i=0;i<slots;i++)chosen.push(rest[(start+i)%rest.length]);
 return chosen;
}
