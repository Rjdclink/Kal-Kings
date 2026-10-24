/** Bounded long-lived market observation sample: current, diverse and exact. */
const ok=(v)=>typeof v==='number'&&Number.isFinite(v);
export function selectHistorySamples(quotes,now=Date.now(),max=12){
 if(!Array.isArray(quotes)||!ok(now)||!Number.isInteger(max)||max<1||max>20)return [];
 const seen=new Set(),eligible=[];
 const depth=q=>[q.yesDepth,q.noDepth].reduce((total,x)=>total+(ok(x)&&x>=0?x:0),0);
 for(const q of quotes){
  if(!q||typeof q.id!=='string'||!/^[A-Z0-9_-]{4,128}$/.test(q.id)||seen.has(q.id))continue;
  const age=now-Date.parse(q.observedAt||'');
  if(!ok(age)||age<0||age>3000)continue;
  if(![q.yesBid,q.yesAsk].every(ok))continue;
  if(q.yesBid<=0||q.yesAsk>=1||q.yesBid>=q.yesAsk)continue;
  seen.add(q.id);eligible.push(q);
 }
 eligible.sort((a,b)=>(depth(b)-depth(a))||a.id.localeCompare(b.id));
 const primaryCount=Math.min(max,Math.ceil(max*.67)),chosen=eligible.slice(0,primaryCount),rest=eligible.slice(primaryCount);
 if(!rest.length)return chosen;
 const start=(Math.floor(now/60000)*Math.max(1,max-primaryCount))%rest.length;
 const slots=Math.min(max-chosen.length,rest.length);
 for(let i=0;i<slots;i++)chosen.push(rest[(start+i)%rest.length]);
 return chosen;
}
