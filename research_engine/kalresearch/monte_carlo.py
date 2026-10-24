"""Seeded stress simulation, not a price forecast or execution guarantee."""
from dataclasses import dataclass
from decimal import ROUND_FLOOR
from math import sqrt
from random import Random
from .core import D, ZERO, sweep


@dataclass(frozen=True)
class Assumptions:
    trials: int
    seed: int
    fill_probability: float
    partial_probability: float
    outage_probability: float
    max_adverse_move: str
    scenario_probabilities: tuple[float, ...]
    provenance: str

    def validate(self, scenario_count):
        if type(self.trials) is not int or not 100 <= self.trials <= 100000:
            raise ValueError('Use 100-100000 trials')
        if type(self.seed) is not int or not self.provenance:
            raise ValueError('Seed and assumption provenance required')
        probabilities = (self.fill_probability, self.partial_probability, self.outage_probability, *self.scenario_probabilities)
        if any(not 0 <= p <= 1 for p in probabilities):
            raise ValueError('Invalid probability')
        if len(self.scenario_probabilities) != scenario_count or abs(sum(self.scenario_probabilities) - 1) > 1e-9:
            raise ValueError('Provide one normalized probability per scenario')
        move = D(self.max_adverse_move)
        if not move.is_finite() or not 0 <= move <= 1:
            raise ValueError('Invalid adverse move')


def simulate(basket, estimate, assumptions):
    """Partial legs are held to a sampled settlement; no free/instant hedge.

    Shared outages and adverse-price shocks correlate legs. Residual fill
    events are independent conditional on the shared shock. Fee upper bounds
    are used, not claimed realized fees. No borrowing, leverage, or live orders.
    """
    basket.validate()
    assumptions.validate(len(basket.scenarios))
    if estimate is None or type(estimate.quantity) is not int or estimate.quantity <= 0:
        raise ValueError('A candidate estimate is required')
    for s in basket.snapshots:
        sweep(s, estimate.quantity)  # ensure proposed size fits original depth
    rng = Random(assumptions.seed)
    results = []
    unhedged = full = no_fill = 0
    max_move = D(assumptions.max_adverse_move)
    for _ in range(assumptions.trials):
        outcome = rng.choices(range(len(basket.scenarios)), assumptions.scenario_probabilities)[0]
        shared_outage = rng.random() < assumptions.outage_probability
        shock = D(str(rng.random())) * max_move
        quantities = []
        cost = payoff = ZERO
        for i, snapshot in enumerate(basket.snapshots):
            quantity = D(estimate.quantity)
            if shared_outage or rng.random() >= assumptions.fill_probability:
                quantity = ZERO
            elif rng.random() < assumptions.partial_probability:
                quantity = (quantity * D(str(rng.random()))).quantize(D('.01'), rounding=ROUND_FLOOR)
            quantities.append(quantity)
            remaining = quantity
            for level in snapshot.asks:
                if remaining == 0:
                    break
                take = min(remaining, level.quantity)
                price = min(D('1'), level.price + shock)
                cost += take * price + snapshot.fees.upper_bound(price, take)
                remaining -= take
            payoff += quantity * basket.payoffs[outcome][i]
        results.append(payoff - cost)
        if all(q == estimate.quantity for q in quantities):
            full += 1
        elif any(quantities):
            unhedged += 1
        else:
            no_fill += 1
    results.sort()
    count = len(results)
    positive = sum(x > 0 for x in results)
    negative = sum(x < 0 for x in results)
    tail = max(1, count // 20)
    mean = sum(results, ZERO) / count
    variance = sum(((x - mean) ** 2 for x in results), ZERO) / (count - 1)
    standard_error = (variance / count).sqrt()
    fraction = positive / count
    z = 1.959963984540054
    denominator = 1 + z*z/count
    center = (fraction + z*z/(2*count)) / denominator
    radius = z * sqrt(fraction*(1-fraction)/count + z*z/(4*count*count)) / denominator
    money = lambda x: str(x.quantize(D('.000001')))
    return {
        'mode': 'SIMULATION_ONLY', 'trials': count, 'seed': assumptions.seed,
        'assumption_provenance': assumptions.provenance,
        'quantity_per_leg': estimate.quantity,
        'mean_pnl': money(mean), 'median_pnl': money(results[count//2]),
        'p05_pnl': money(results[int((count-1)*.05)]),
        'p95_pnl': money(results[int((count-1)*.95)]),
        'worst_trial_pnl': money(results[0]),
        'mean_worst_5_percent_pnl': money(sum(results[:tail], ZERO)/tail),
        'positive_fraction': fraction, 'loss_fraction': negative/count,
        'full_fill_fraction': full/count, 'partial_or_unhedged_fraction': unhedged/count,
        'no_fill_fraction': no_fill/count,
        'positive_fraction_wilson_95': [max(0, center-radius), min(1, center+radius)],
        'mean_pnl_mc_95': [money(mean-D(str(z))*standard_error), money(mean+D(str(z))*standard_error)],
        'interpretation': 'Intervals measure Monte Carlo sampling error conditional on supplied assumptions, not uncertainty about real-world profitability. Includes no-fill trials. Partial legs held to settlement. Taxes, funding, settlement delay and venue default are not modeled.'
    }
