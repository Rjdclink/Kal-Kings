import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverQuotedGaps} from './feeds.mjs';
import {readFileSync} from 'node:fs';
test('public cross-venue quote comparison is strictly read-only',()=>{
 const source=readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
 assert.match(source,/currentDraftKingsOdds/);
 assert.match(source,/discoverQuotedGaps/);
 assert.doesNotMatch(source,/automaticallyHedgeAcceptedDraftKingsTicket/);
 assert.doesNotMatch(source,/\/api\/dk\/wager/);
});
