import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
test('fast crypto scan imports every candidate selector it invokes',()=>{
 assert.match(source,/import\s*\{[^}]*\bselectCryptoIdea\b[^}]*\}\s*from\s*['"]\.\/crypto_candidate\.mjs['"]/);
 assert.match(source,/signals\.map\(x=>selectCryptoIdea\(x,/);
});
