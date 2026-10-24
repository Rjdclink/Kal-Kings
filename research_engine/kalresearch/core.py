"""Exact-money, buy-only scenario analysis for reviewed financial contracts."""
from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING
from typing import Protocol

D = Decimal
ZERO = D('0')
ALLOWED_CATEGORIES = frozenset({'economics', 'financials'})


def decimal(value):
    if isinstance(value, (float, bool)):
        raise ValueError('Use decimal strings, not floats or booleans')
    result = D(value)
    if not result.is_finite():
        raise ValueError('Non-finite number')
    return result


@dataclass(frozen=True)
class Level:
    price: Decimal
    quantity: Decimal

    def __post_init__(self):
        if not isinstance(self.price, D) or not isinstance(self.quantity, D):
            raise ValueError('Levels require Decimal values')
        if not self.price.is_finite() or not self.quantity.is_finite():
            raise ValueError('Non-finite level')
        if not ZERO < self.price < 1 or self.quantity <= 0:
            raise ValueError('Invalid price or quantity')
        if self.price != self.price.quantize(D('.0001')) or self.quantity != self.quantity.quantize(D('.01')):
            raise ValueError('Unsupported fixed-point precision')


@dataclass(frozen=True)
class Fees:
    coefficient: Decimal
    multiplier: Decimal
    balance_quantum: Decimal
    verified_until_ms: int
    source: str

    def __post_init__(self):
        for value in (self.coefficient, self.multiplier, self.balance_quantum):
            if not isinstance(value, D) or not value.is_finite() or value < 0:
                raise ValueError('Invalid fee value')
        if self.balance_quantum not in (D('.0001'), D('.01')) or not self.source:
            raise ValueError('Fee precision and provenance required')

    def upper_bound(self, price, quantity):
        # Model fee plus pessimistic per-fill rounding, ignoring all rebates.
        # With .01 quantity grid at most quantity/.01 fills can occur.
        model = self.coefficient * self.multiplier * quantity * price * (1 - price)
        max_fills = (quantity / D('.01')).to_integral_value(rounding=ROUND_CEILING)
        return model + max_fills * (D('.000001') + self.balance_quantum)


@dataclass(frozen=True)
class Snapshot:
    venue: str
    ticker: str
    side: str
    category: str
    rules_hash: str
    observed_ms: int
    asks: tuple[Level, ...]
    fees: Fees
    active: bool = True
    healthy: bool = True

    @property
    def key(self):
        return (self.venue, self.ticker, self.side)

    def __post_init__(self):
        if self.side not in ('yes', 'no') or not all((self.venue, self.ticker, self.rules_hash)):
            raise ValueError('Incomplete instrument identity')
        prices = [x.price for x in self.asks]
        if prices != sorted(set(prices)):
            raise ValueError('Ask levels must be unique and ascending')


@dataclass(frozen=True)
class ReviewedBasket:
    snapshots: tuple[Snapshot, ...]
    scenarios: tuple[str, ...]
    # Each row gives gross USD payoff per unit of each leg in that scenario.
    payoffs: tuple[tuple[Decimal, ...], ...]
    review_reference: str
    exhaustive: bool

    def validate(self):
        n = len(self.snapshots)
        if not 2 <= n <= 16 or not self.review_reference or not self.exhaustive:
            raise ValueError('Require 2-16 legs and reviewed exhaustive settlement scenarios')
        if len({s.key for s in self.snapshots}) != n:
            raise ValueError('Duplicate instrument would double-count liquidity')
        if not self.scenarios or len(set(self.scenarios)) != len(self.scenarios):
            raise ValueError('Distinct settlement scenarios required')
        if len(self.payoffs) != len(self.scenarios):
            raise ValueError('Scenario count mismatch')
        for row in self.payoffs:
            if len(row) != n or any(not isinstance(p, D) or not p.is_finite() or p < 0 or p > 1 for p in row):
                raise ValueError('Invalid payoff matrix')
        if any(s.category not in ALLOWED_CATEGORIES for s in self.snapshots):
            raise ValueError('Only verified economics and financials categories supported')


@dataclass(frozen=True)
class Limits:
    budget: Decimal = D('100')
    max_quantity: int = 100
    min_profit: Decimal = D('.10')
    slippage_per_contract: Decimal = D('.005')
    max_age_ms: int = 2000
    max_skew_ms: int = 500

    def __post_init__(self):
        for value in (self.budget, self.min_profit, self.slippage_per_contract):
            if not isinstance(value, D) or not value.is_finite() or value < 0:
                raise ValueError('Invalid risk limit')
        if self.budget <= 0 or self.min_profit <= 0 or type(self.max_quantity) is not int or not 1 <= self.max_quantity <= 10000:
            raise ValueError('Invalid budget, threshold, or search size')
        if self.max_age_ms < 0 or self.max_skew_ms < 0:
            raise ValueError('Invalid clock limits')


@dataclass(frozen=True)
class Estimate:
    quantity: int
    principal: Decimal
    fee_bound: Decimal
    slippage_reserve: Decimal
    minimum_payoff: Decimal
    profit_bound: Decimal
    venue_debits: tuple[tuple[str, Decimal], ...]


def sweep(snapshot, quantity):
    remaining = D(quantity)
    principal = fee = ZERO
    for level in snapshot.asks:
        take = min(remaining, level.quantity)
        principal += take * level.price
        fee += snapshot.fees.upper_bound(level.price, take)
        remaining -= take
        if not remaining:
            return principal, fee
    raise ValueError('Insufficient displayed depth')


def analyze(basket, limits, now_ms, balances=None):
    """Best equal-unit basket within bounded integer search, or None.

    Conditional model bound, not a guarantee of execution or settlement.
    Supplied balances are free cash AFTER all existing reservations.
    """
    basket.validate()
    for s in basket.snapshots:
        if not s.active or not s.healthy:
            raise ValueError('Inactive market or unhealthy feed')
        if not 0 <= now_ms - s.observed_ms <= limits.max_age_ms:
            raise ValueError('Stale or future snapshot')
        if s.fees.verified_until_ms <= now_ms:
            raise ValueError('Fee verification expired')
    timestamps = [s.observed_ms for s in basket.snapshots]
    if max(timestamps) - min(timestamps) > limits.max_skew_ms:
        raise ValueError('Snapshots are not sufficiently synchronized')
    if balances is not None:
        for value in balances.values():
            if not isinstance(value, D) or not value.is_finite() or value < 0:
                raise ValueError('Invalid available balance')
    floor = min(sum(row, ZERO) for row in basket.payoffs)
    depth = min(sum((x.quantity for x in s.asks), ZERO) for s in basket.snapshots)
    best = None
    for quantity in range(1, min(limits.max_quantity, int(depth)) + 1):
        principal = fees = ZERO
        debits = {}
        for s in basket.snapshots:
            cost, fee = sweep(s, quantity)
            principal += cost
            fees += fee
            debits[s.venue] = debits.get(s.venue, ZERO) + cost + fee + limits.slippage_per_contract * quantity
        reserve = limits.slippage_per_contract * quantity * len(basket.snapshots)
        total = principal + fees + reserve
        if total > limits.budget:
            break
        if balances is not None and any(v > balances.get(k, ZERO) for k, v in debits.items()):
            continue
        profit = floor * quantity - total
        if profit >= limits.min_profit and (best is None or profit > best.profit_bound):
            best = Estimate(quantity, principal, fees, reserve, floor * quantity, profit, tuple(sorted(debits.items())))
    return best


class FinancialDataAdapter(Protocol):
    """Read-only interface; implementations must enforce non-sports metadata."""
    def snapshot(self, ticker: str, side: str, *, category: str,
                 expected_rules_hash: str, fees: Fees) -> Snapshot: ...
