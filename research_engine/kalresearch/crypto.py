"""Key-free spot-market observations and conditional historical bootstrap."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import json
import math
from random import Random
from statistics import median
import time
from urllib.request import Request, urlopen
from .core import D, decimal
from .depth import fetch_book, quote_buy

SYMBOLS = ('BTC', 'ETH')
VENUES = ('coinbase', 'kraken', 'bitstamp')


@dataclass(frozen=True)
class Candle:
    start: int
    close: D


def public_json(url):
    with urlopen(Request(url, headers={'User-Agent': 'KalKings-Research/1.0'}), timeout=8) as response:
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Oversized market response')
        return json.loads(raw, parse_float=D)


def fetch_candles(venue, symbol, now, transport=public_json):
    if symbol not in SYMBOLS or venue not in VENUES:
        raise ValueError('Unsupported spot market')
    if venue == 'coinbase':
        payload = transport(f'https://api.exchange.coinbase.com/products/{symbol}-USD/candles?granularity=3600')
        rows = [(r[0],r[4]) for r in payload]
    elif venue == 'kraken':
        pair = 'XBTUSD' if symbol == 'BTC' else 'ETHUSD'
        payload = transport(f'https://api.kraken.com/0/public/OHLC?pair={pair}&interval=60')
        if payload.get('error'):
            raise ValueError('Exchange returned an error')
        result = payload['result']
        keys = [k for k in result if k != 'last']
        if len(keys) != 1:
            raise ValueError('Ambiguous pair response')
        rows = [(r[0],r[4]) for r in result[keys[0]]]
    else:
        payload = transport(f'https://www.bitstamp.net/api/v2/ohlc/{symbol.lower()}usd/?step=3600&limit=300&exclude_current_candle=true')
        rows = [(r['timestamp'],r['close']) for r in payload['data']['ohlc']]
    candles = {}
    for timestamp, close in rows:
        stamp, price = int(timestamp), decimal(close)
        if stamp < 0 or stamp % 3600 or price <= 0:
            raise ValueError('Invalid hourly candle')
        if stamp+3600 > now:
            continue  # never use the unfinished candle
        if stamp in candles:
            raise ValueError('Duplicate candle timestamp')
        candles[stamp] = price
    return tuple(Candle(t,p) for t,p in sorted(candles.items()))


def consensus(feeds, now, threshold=D('.001')):
    """Agreement in observed 24h momentum on identical completed USD bars."""
    if not threshold.is_finite() or threshold < 0:
        raise ValueError('Invalid neutral band')
    end = (int(now)//3600-1)*3600
    usable, rejected = {}, {}
    for venue, candles in feeds.items():
        by_time = {c.start:c.close for c in candles}
        if len(by_time) != len(candles):
            rejected[venue] = 'Duplicate bars'
        elif end not in by_time or end-24*3600 not in by_time:
            rejected[venue] = 'Missing synchronized 24-hour endpoints'
        elif any(not p.is_finite() or p <= 0 for p in by_time.values()):
            rejected[venue] = 'Invalid prices'
        else:
            usable[venue] = by_time
    if len(usable) < 2:
        raise ValueError('At least two fresh, synchronized exchange histories required')
    votes = []
    for venue, bars in sorted(usable.items()):
        change = bars[end]/bars[end-24*3600]-1
        direction = 'up' if change > threshold else ('down' if change < -threshold else 'neutral')
        votes.append({'venue':venue,'direction':direction,'change_24h':str(change),'close_usd':str(bars[end])})
    up = sum(v['direction']=='up' for v in votes)
    down = sum(v['direction']=='down' for v in votes)
    direction = 'up' if up > len(votes)/2 else ('down' if down > len(votes)/2 else 'mixed')
    # Require contiguous shared history; do not compress gaps into hourly returns.
    shared = set.intersection(*(set(b) for b in usable.values()))
    timestamps=[]
    stamp=end
    while stamp in shared and len(timestamps)<300:
        timestamps.append(stamp)
        stamp-=3600
    timestamps.reverse()
    if len(timestamps)<72:
        raise ValueError('Need at least 72 contiguous synchronized completed hours')
    prices=[median([bars[t] for bars in usable.values()]) for t in timestamps]
    return {'direction':direction,'agreeing_venues':max(up,down),'available_venues':len(votes),
            'votes':votes,'bar_end_utc_epoch':end+3600,'history_hours':len(prices),
            'rejected_venues':rejected,
            'meaning':'Observed momentum agreement among available exchanges, not a probability forecast or a majority of all markets.'}, prices


def bootstrap_profit(prices, capital=D('1000'), fee_rate=D('.006'),
                     slippage_rate=D('.001'), hours=24, trials=5000, seed=20261024,
                     entry_slippage_rate=None):
    """Long-only spot round trip; contiguous six-hour return blocks.

    Rates are configurable assumptions, not verified exchange fee tiers.
    Floating-point log/exp is intentional statistical approximation; money
    summaries are formatted only after simulation. This is not arbitrage.
    """
    if len(prices)<72 or any(not isinstance(p,D) or not p.is_finite() or p<=0 for p in prices):
        raise ValueError('At least 72 positive finite closes required')
    if not capital.is_finite() or capital<=0:
        raise ValueError('Invalid capital')
    entry_rate=slippage_rate if entry_slippage_rate is None else entry_slippage_rate
    if any(not x.is_finite() or not 0<=x<D('.1') for x in (fee_rate,slippage_rate,entry_rate)):
        raise ValueError('Invalid cost assumption')
    if type(hours) is not int or not 1<=hours<=168 or type(trials) is not int or not 100<=trials<=100000:
        raise ValueError('Invalid simulation dimensions')
    returns=[math.log(float(b/a)) for a,b in zip(prices,prices[1:])]
    rng=Random(seed)
    result=[]
    cost=float(fee_rate+slippage_rate)
    entry_cost=float(fee_rate+entry_rate)
    for _ in range(trials):
        path=[]
        while len(path)<hours:
            start=rng.randrange(len(returns)-5)
            path.extend(returns[start:start+6])
        terminal=math.exp(sum(path[:hours]))
        # Capital includes entry fee/slippage, then exit costs on proceeds.
        result.append(float(capital)*(terminal*(1-cost)/(1+entry_cost)-1))
    result.sort()
    money=lambda x:format(x,'.2f')
    tail=max(1,trials//20)
    return {'strategy':'HYPOTHETICAL_LONG_ONLY_SPOT','capital_usd':str(capital),
            'horizon_hours':hours,'trials':trials,'seed':seed,
            'expected_profit_dollars':money(sum(result)/trials),
            'p05_profit_dollars':money(result[int((trials-1)*.05)]),
            'p95_profit_dollars':money(result[int((trials-1)*.95)]),
            'mean_worst_5_percent_dollars':money(sum(result[:tail])/tail),
            'loss_fraction':sum(x<0 for x in result)/trials,
            'fee_rate_each_side':str(fee_rate),'exit_slippage_rate':str(slippage_rate),
            'entry_slippage_rate':str(entry_rate),
            'assumptions':'Six-hour moving-block resampling of recent hourly median USD closes; historical regime persists. Cost rates are illustrative. Correlated exchange prices are not independent evidence. No order fills, shorting, funding, taxes, outages or venue-default model.'}


def scan(symbols=SYMBOLS, transport=public_json, now=None):
    if not symbols or len(set(symbols))!=len(symbols) or any(s not in SYMBOLS for s in symbols):
        raise ValueError('Use distinct supported symbols')
    now=time.time() if now is None else now
    feeds={s:{} for s in symbols}
    errors={s:{} for s in symbols}
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs={pool.submit(fetch_candles,v,s,now,transport):(s,v) for s in symbols for v in VENUES}
        for future in as_completed(jobs):
            symbol,venue=jobs[future]
            try:
                feeds[symbol][venue]=future.result()
            except Exception as exc:
                errors[symbol][venue]=type(exc).__name__
    books={s:[] for s in symbols}
    book_errors={s:{} for s in symbols}
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs={pool.submit(fetch_book,v,s,transport):(s,v) for s in symbols for v in VENUES}
        for future in as_completed(jobs):
            symbol,venue=jobs[future]
            try:
                book=future.result()
                books[symbol].append(quote_buy(book,D('1000'),time.time()))
            except Exception as exc:
                book_errors[symbol][venue]=type(exc).__name__
    assets=[]
    for symbol in symbols:
        try:
            signal,prices=consensus(feeds[symbol],now)
            forecast=bootstrap_profit(prices)
            depth_forecasts=[]
            for book in books[symbol]:
                try:
                    adjusted=bootstrap_profit(prices,entry_slippage_rate=D(book['entry_cost_vs_mid_rate']))
                    depth_forecasts.append({'venue':book['venue'],'forecast':adjusted,
                                            'basis':'Observed entry VWAP versus mid; future exit slippage and fees remain assumptions. Snapshot is not an executable quote.'})
                except ValueError:
                    book_errors[symbol][book['venue']]='Entry cost outside supported simulation range'
            assets.append({'symbol':symbol,'status':'OBSERVED','consensus':signal,'forecast':forecast,
                           'source_errors':errors[symbol],'orderbooks':sorted(books[symbol],key=lambda b:b['venue']),
                           'orderbook_errors':book_errors[symbol],
                           'depth_adjusted_forecasts':depth_forecasts,
                           'forecast_prices':[str(p) for p in prices]})
        except ValueError as exc:
            assets.append({'symbol':symbol,'status':'UNAVAILABLE','reason':str(exc),'source_errors':errors[symbol]})
    assets.sort(key=lambda a:float(a.get('forecast',{}).get('expected_profit_dollars','-inf')),reverse=True)
    return {'mode':'PUBLIC_SPOT_RESEARCH','observed_at_utc_epoch':int(now),'refresh_seconds':60,'assets':assets,
            'ranking_basis':'Modeled 24-hour net dollar return for the same $1000 illustrative long-only capital. Negative forecasts are retained; this is not a trade recommendation.'}
