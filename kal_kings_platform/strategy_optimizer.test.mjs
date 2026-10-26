import test from 'node:test';
import assert from 'node:assert/strict';
import {technicalIndicators,assessCryptoRegime} from './strategy_optimizer.mjs';
const candles=Array.from({length:55},(_,i)=>({time:i,open:100+i*.3,high:101+i*.3,low:99+i*.3,close:100.5+i*.3,volume:100+i}));
test('indicators report RSI MACD and volume',()=>{const a=technicalIndicators(candles);assert.ok(Number.isFinite(a.rsi));assert.ok(Number.isFinite(a.macdHistogram));assert.equal(a.isCalibratedPrediction,false)});
test('consensus needs three sources',()=>{const d=assessCryptoRegime({direction:'UP',sources:1,agreement:1},technicalIndicators(candles));assert.equal(d.direction,'UNKNOWN')});
import {walkForwardScore} from './strategy_optimizer.mjs';
test('unresolved observations are never evaluated as proven predictions',()=>{assert.equal(walkForwardScore([]).status,'INSUFFICIENT_RESOLVED_SAMPLE')});
