/** Research-only public page crawler pool. Adapted LegalWhat StarTrekCrawler's
 * bounded GET and public link/text extraction; zero Firecrawl requests.
 * Crawler output is NEVER used as authenticated Kalshi price/settlement evidence.
 */
const PUBLIC_HOSTS=new Set(['www.espn.com','www.kalshi.com','kalshi.com',
 'help.kalshi.com','docs.kalshi.com','www.cftc.gov']);
const limits=Object.freeze({'legalwhat-direct':{max:36,window:60000},
 'jina-reader':{max:12,window:60000},
 'markdown-new':{max:400,window:86400000},
 'crawl4ai-cloud':{max:75,window:86400000}});
const catalog=['legalwhat-direct','jina-reader','markdown-new','crawl4ai-cloud'];
const stripMarkup=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const parsePublicUrl=url=>{
 let u;
 try{u=new URL(url)}catch{throw Error('Invalid public source URL')}
 if(u.protocol!=='https:'||!PUBLIC_HOSTS.has(u.hostname)||u.port||
    u.username||u.password||u.pathname.startsWith('/api/')||
    /\/(?:trade-api|portfolio|orders|account|balance|private)\b/i.test(u.pathname))throw Error('Public source not approved');
 u.hash='';return u;
};
export function makeResearchCrawlerPool({fetcher=fetch,env=process.env,now=Date.now}={}){
 let ordinal=0;const events=new Map();
 const stats=new Map(catalog.map(name=>[name,{successes:0,failures:0,lastSucceeded:null,lastFailure:null,requests:[]}]));
 const configured=name=>name!=='crawl4ai-cloud'||Boolean(env.CRAWL4AI_KEY);
 const status=()=>catalog.map(name=>{
   const x=stats.get(name);return {name,configured:configured(name),successes:x.successes,
     failures:x.failures,lastSucceeded:x.lastSucceeded,lastFailure:x.lastFailure,
     limits:{...limits[name]}};});
 const checkQuota=(name,ts)=>{
   const x=stats.get(name),lim=limits[name];
   x.requests=x.requests.filter(t=>ts-t<lim.window);
   return x.requests.length<lim.max&&!(x.lastFailure!=null&&ts-x.lastFailure<20000);
 };
 async function requestText(url,opts={}){
   const response=await fetcher(url,{...opts,redirect:'error',signal:AbortSignal.timeout(7500)});
   if(!response?.ok)throw Error('Crawler provider rejected request');
   const body=await response.text();
   if(typeof body!=='string'||body.length<15||body.length>3000000)throw Error('Crawler response invalid');
   return body.slice(0,70000);
 }
 async function provider(name,url){
   if(name==='legalwhat-direct'){
     // LegalWhat StarTrekCrawler's public fetch / bounded HTML extraction pattern.
     const raw=await requestText(url.toString(),{method:'GET',headers:{accept:'text/html,text/markdown'}});
     const content=raw.includes('<html')||raw.includes('<body')?stripMarkup(raw):raw;
     if(content.length<15)throw Error('Empty public document');
     return content.slice(0,40000);
   }
   if(name==='jina-reader')return requestText('https://r.jina.ai/'+url.toString(),{
     method:'GET',headers:{accept:'text/markdown'}});
   if(name==='markdown-new')return requestText('https://markdown.new/'+url.toString(),{
     method:'GET',headers:{accept:'text/markdown'}});
   if(name==='crawl4ai-cloud'){
     if(!env.CRAWL4AI_KEY)throw Error('Crawl4AI not configured');
     const result=await fetcher('https://api.crawl4ai.com/scrape',{
       method:'POST',redirect:'error',signal:AbortSignal.timeout(7500),
       headers:{authorization:'Bearer '+env.CRAWL4AI_KEY,'content-type':'application/json'},
       body:JSON.stringify({url:url.toString()})});
     if(!result?.ok)throw Error('Crawl4AI did not return a usable result');
     const response=await result.json();
     const raw=response?.markdown||response?.data?.markdown;
     if(typeof raw!=='string'||raw.length<15)return (()=>{throw Error('Crawl4AI content unavailable')})();
     return raw.slice(0,40000);
   }
   throw Error('Unknown crawler provider');
 }
 return {status,async get(target){
    const url=parsePublicUrl(target),ts=now(),start=ordinal++%catalog.length;
    for(let i=0;i<catalog.length;i++){
      const name=catalog[(start+i)%catalog.length];
      if(!configured(name)||!checkQuota(name,ts))continue;
      const x=stats.get(name);x.requests.push(ts);
      try{
        const content=await provider(name,url);
        x.successes++;x.lastSucceeded=now();
        return {provider:name,url:url.toString(),content,observedAt:new Date(Date.now()).toISOString(),
          executionApproved:false,authority:'UNVERIFIED_CONTEXT_ONLY'};
      }catch{x.failures++;x.lastFailure=now();}
    }
    throw Error('No public research crawler available');
 }};
}
