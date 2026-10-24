"""Public GET-only Kalshi adapter. No credentials, account access, or orders."""
import hashlib
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen
from .core import ALLOWED_CATEGORIES, D, Level, Snapshot, decimal


def rules_digest(market):
    fields = ('ticker', 'event_ticker', 'market_type', 'rules_primary', 'rules_secondary', 'expiration_time')
    if not market.get('rules_primary') or market.get('market_type') != 'binary':
        raise ValueError('Full binary market rules required')
    return hashlib.sha256(json.dumps({k: market.get(k) for k in fields}, sort_keys=True).encode()).hexdigest()


def normalize_book(payload, side):
    if side not in ('yes', 'no'):
        raise ValueError('Unknown side')
    book = payload['orderbook_fp']
    opposite = 'no_dollars' if side == 'yes' else 'yes_dollars'
    levels = tuple(sorted((Level(D(1) - decimal(p), decimal(q)) for p, q in book[opposite]), key=lambda x: x.price))
    if len({x.price for x in levels}) != len(levels):
        raise ValueError('Duplicate orderbook price')
    return levels


class KalshiPublic:
    BASE = 'https://external-api.kalshi.com/trade-api/v2'

    def __init__(self, transport=None, clock=None, sleep=None):
        self.transport = transport or self._transport
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.sleep = sleep or time.sleep
        self._last_request = 0.0

    @staticmethod
    def _transport(url):
        with urlopen(url, timeout=10) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Oversized response')
            return json.loads(raw, parse_float=D)

    def get(self, path):
        if not path.startswith(('/markets/', '/events/', '/series/')):
            raise ValueError('Read-only market endpoint required')
        for attempt in range(3):
            # Conservative pacing, not an assertion about account rate limits.
            self.sleep(max(0, .25 - (time.monotonic() - self._last_request)))
            self._last_request = time.monotonic()
            try:
                return self.transport(self.BASE + path)
            except HTTPError as exc:
                if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
                delay = exc.headers.get('Retry-After', '') if exc.headers else ''
                self.sleep(min(10, max(0, float(delay))) if delay.isdigit() else 2 ** attempt)
            except (URLError, TimeoutError):
                if attempt == 2:
                    raise
                self.sleep(2 ** attempt)

    @staticmethod
    def _id(value):
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,200}', value):
            raise ValueError('Invalid ticker')
        return quote(value, safe='')

    def snapshot(self, ticker, side, *, category, expected_rules_hash, fees):
        if category not in ALLOWED_CATEGORIES:
            raise ValueError('Non-sports financial category required')
        market = self.get('/markets/' + self._id(ticker))['market']
        if market.get('ticker') != ticker:
            raise ValueError('Market identity mismatch')
        event = self.get('/events/' + self._id(market['event_ticker']))['event']
        series = self.get('/series/' + self._id(event['series_ticker']))['series']
        # Require all supplied classifications to be supported; mixed sports tags fail.
        categories = {str(x).lower() for x in series.get('categories', [])}
        if series.get('category'):
            categories.add(str(series['category']).lower())
        if not categories or not categories <= ALLOWED_CATEGORIES or category not in categories:
            raise ValueError('Unverified or unsupported series category')
        digest = rules_digest(market)
        if digest != expected_rules_hash:
            raise ValueError('Rules changed or have not been reviewed')
        if market.get('status') != 'active':
            raise ValueError('Market is not active')
        started = self.clock()
        payload = self.get('/markets/' + self._id(ticker) + '/orderbook')
        # Timestamp request START, so response latency ages the quote conservatively.
        return Snapshot('kalshi', ticker, side, category, digest, started,
                        normalize_book(payload, side), fees)
