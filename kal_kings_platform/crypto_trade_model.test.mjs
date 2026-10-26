import test from 'node:test';
import assert from 'node:assert/strict';
import {runCryptoMonteCarlo} from './crypto_trade_model.mjs';
test('simulations require a grounded beginning reference',()=>assert.equal(runCryptoMonteCarlo({}).status,'UNVERIFIED_REFERENCE'));
