import test from 'node:test';
import assert from 'node:assert/strict';
import {makeResearchCrawlerPool} from './research_crawlers.mjs';

test('crawler pool dynamically rotates LegalWhat direct, Jina and markdown.new with a Crawl4AI adapter',async()=>{
 const urls=[],get=async url=>{
  urls.push(String(url));
  return {ok:true,status:200,headers:{get:()=> 'text/markdown'},text:async()=> '# Verified sample public page about NFL sports\nUseful event context',json:async()=>({markdown:'# Crawl4AI sample public page'})};
 };
 const pool=makeResearchCrawlerPool({fetcher:get,now:()=>1000000,env:{CRAWL4AI_KEY:'test-key'}});
 const a=await Promise.all(Array.from({length:4},()=>pool.get('https://www.espn.com/nfl/scoreboard')));
 assert.deepEqual(new Set(a.map(x=>x.provider)),new Set(['legalwhat-direct','jina-reader','markdown-new','crawl4ai-cloud']));
 assert.ok(urls.some(x=>x.startsWith('https://r.jina.ai/')));
 assert.ok(urls.some(x=>x.startsWith('https://markdown.new/')));
 assert.ok(urls.some(x=>x.startsWith('https://api.crawl4ai.com/scrape')));
});

test('crawler failover moves to another adapter without retrying a failed provider recursively',async()=>{
 const calls=[];
 const fetcher=async url=>{
  calls.push(String(url));
  if(String(url).startsWith('https://www.espn.com'))throw Error('origin blocked');
  return {ok:true,headers:{get:()=> 'text/markdown'},text:async()=> '# Fallback sports source\nPrimary service unavailable'};
 };
 const crawler=makeResearchCrawlerPool({fetcher,env:{},now:()=>1000});
 const out=await crawler.get('https://www.espn.com/nfl/scoreboard');
 assert.notEqual(out.provider,'legalwhat-direct');assert.equal(out.content.includes('Fallback'),true);
 assert.ok(calls.length<=4);
});

test('crawler only fetches approved public sports documentation; no secrets, localhost or exchange order URLs',async()=>{
 let called=0;const crawler=makeResearchCrawlerPool({fetcher:async()=>{called++;throw Error('should not fetch')}});
 for(const url of ['http://127.0.0.1:8080','https://localhost/admin','https://internal.espn.com/',
   'https://external-api.kalshi.com/trade-api/v2/portfolio/orders',
   'https://www.espn.com@127.0.0.1/','file:///etc/passwd']){
   await assert.rejects(()=>crawler.get(url));
 }
 assert.equal(called,0);
});

test('crawler does not claim failed or absent hosted provider credentials are live connections',async()=>{
 const crawler=makeResearchCrawlerPool({env:{},fetcher:async()=>{throw Error('offline')}});
 const status=crawler.status();
 assert.equal(status.find(x=>x.name==='crawl4ai-cloud').configured,false);
 assert.equal(status.find(x=>x.name==='jina-reader').configured,true);
 assert.equal(status.find(x=>x.name==='markdown-new').configured,true);
});