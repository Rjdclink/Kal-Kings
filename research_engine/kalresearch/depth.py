"""Exact public spot book observations; never claims guaranteed fills."""
from dataclasses import dataclass
import time
from .core import D, decimal


@dataclass(frozen=True)
class Book:
    venue: str
    symbol: str
    started_at: float
    received_at: float
    bids: tuple
    asks: tuple


def levels(rows, reverse=False):
    parsed=[]
    for row in rows:
        price,quantity=decimal(row[0]),decimal(row[1])
        if price<=0 or quantity<=0:
            raise ValueError('Invalid book level')
        parsed.append((price,quantity))
    if not parsed or len({p for p,q in parsed})!=len(parsed):
        raise ValueError('Empty or duplicate book levels')
    return tuple(sorted(parsed,reverse=reverse))


def fetch_book(venue,symbol,transport,clock=time.time):
    if symbol not in ('BTC','ETH'):
        raise ValueError('Unsupported asset')
    started=clock()
    if venue=='coinbase':
        payload=transport(f'https://api.exchange.coinbase.com/products/{symbol}-USD/book?level=2')
    elif venue=='kraken':
        pair='XBTUSD' if symbol=='BTC' else 'ETHUSD'
        data=transport(f'https://api.kraken.com/0/public/Depth?pair={pair}&count=100')
        if data.get('error') or len(data.get('result',{}))!=1:
            raise ValueError('Invalid exchange book response')
        payload=next(iter(data['result'].values()))
    elif venue=='bitstamp':
        payload=transport(f'https://www.bitstamp.net/api/v2/order_book/{symbol.lower()}usd/?group=1')
    else:
        raise ValueError('Unsupported venue')
    bids,asks=levels(payload['bids'],True),levels(payload['asks'])
    if bids[0][0]>=asks[0][0]:
        raise ValueError('Crossed or locked snapshot')
    return Book(venue,symbol,started,clock(),bids,asks)


def quote_buy(book,budget,now,max_age=5):
    if not isinstance(budget,D) or not budget.is_finite() or budget<=0:
        raise ValueError('Invalid notional')
    if not book.started_at<=book.received_at<=now or now-book.started_at>max_age:
        raise ValueError('Stale, future or slow book snapshot')
    remaining,quantity=D(budget),D('0')
    for price,available in book.asks:
        notional=min(remaining,price*available)
        quantity+=notional/price
        remaining-=notional
        if remaining==0:
            break
    if remaining>0:
        raise ValueError('Insufficient displayed ask liquidity')
    vwap=budget/quantity
    mid=(book.bids[0][0]+book.asks[0][0])/2
    return {'venue':book.venue,'symbol':book.symbol,'observed_at_utc_epoch':book.received_at,
            'request_started_utc_epoch':book.started_at,'valid_for_seconds':max_age,
            'best_bid_usd':str(book.bids[0][0]),'best_ask_usd':str(book.asks[0][0]),
            'spread_usd':str(book.asks[0][0]-book.bids[0][0]),
            'visible_bid_notional_usd':str(sum((p*q for p,q in book.bids),D('0'))),
            'visible_ask_notional_usd':str(sum((p*q for p,q in book.asks),D('0'))),
            'buy_notional_excluding_fees_usd':str(budget),'estimated_base_quantity':str(quantity),
            'estimated_vwap_usd':str(vwap),'entry_cost_vs_mid_rate':str(vwap/mid-1),
            'execution_status':'UNCONFIRMED_PUBLIC_SNAPSHOT',
            'meaning':'Displayed aggregated depth, not full venue liquidity or guaranteed execution. Fees, lot-size rounding, cancellations and latency still apply.'}
