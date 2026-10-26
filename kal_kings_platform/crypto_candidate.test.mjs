import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCryptoIdea} from './crypto_candidate.mjs';
test('missing research cannot qualify',()=>assert.equal(selectCryptoIdea(null),null));
