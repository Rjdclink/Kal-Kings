import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTradingViewAlert,mergeCryptoAlerts,priceTrendFromCandles} from './tradingview.mjs';

const clock=Date.parse('2026-10-24T18:00:00Z');

test('TradeView alert accepts supported assets, records immutable attribution and signal age',()=>{
 const payload={ticker:'COINBASE:ETHUSD',action:'buy',close:'3782.50',time:'2026-10-24T17:59:30Z',interval:'15'};
 const a=parseTradingViewAlert(payload,clock);
 assert.equal(a.symbol,'ETH/USD');assert.equal(a.direction,'BULLISH');assert.equal(a.price,3782.5);
 assert.equal(a.source,'TradingView user-configured alert');assert.equal(a.ageMs,30000);
 assert.equal(a.time,'2026-10-24T17:59:30.000Z');
});

test('rejects stale, future, malformed, or unknown symbols, and invalid prices',()=>{
 for(const data of [
   {ticker:'DOGEUSD',action:'sell',close:1,time:'2026-10-24T17:40:00Z'},
   {ticker:'BTCUSD',action:'buy',close:1,time:'2026-10-24T18:03:00Z'},
   {ticker:'GOLDUSD',action:'buy',close:1,time:'2026-10-24T17:59:00Z'},
   {ticker:'BTCUSD',action:'hold',close:1,time:'2026-10-24T17:59:00Z'},
   {ticker:'BTCUSD',action:'buy',close:-3,time:'2026-10-24T17:59:00Z'},
 ])assert.throws(()=>parseTradingViewAlert(data,clock));
});

test('crypto board attaches alerts without converting them into automatic trades',()=>{
 const spot=[{symbol:'ETH/USD',price:3700},{symbol:'BTC/USD',price:75000}];
 const alerts=[{id:'a',symbol:'ETH/USD',direction:'BULLISH',time:'2026-10-24T17:59:30Z',price:3710}];
 const rows=mergeCryptoAlerts(spot,alerts,clock);
 assert.equal(rows[0].tradingView.direction,'BULLISH');
 assert.equal(rows[0].tradingView.executionApproved,false);
 assert.equal(rows[1].tradingView,null);
});

test('derive moving-average trend using completed public spot candles without pretending it is TradingView API',()=>{
 const candles=Array.from({length:60},(_,i)=>({close:100+i}));
 const r=priceTrendFromCandles(candles);
 assert.equal(r.source,'Coinbase spot candles');
 assert.equal(r.trend,'UP');
 assert.equal(r.executionApproved,false);
});
