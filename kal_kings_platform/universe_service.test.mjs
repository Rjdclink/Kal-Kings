import test from 'node:test';
import assert from 'node:assert/strict';
import {makeUniverseScanner} from './universe_service.mjs';
test('rolling universe scanner samples public markets with persisted cursor',async()=>{let saved=0;const s=makeUniverseScanner({sql:async(q,p)=>{if(q.startsWith('SELECT'))return [];saved++;return []},fetcher:async()=>({markets:[],cursor:null})});const r=await s.scan();assert.equal(r.scanned,0);assert.equal(saved,1)});
