"""Rank modeled net dollars over a declared set of opportunities and sizes."""
from dataclasses import replace
from .core import D, analyze
from .monte_carlo import simulate


def rank_opportunities(opportunities, now_ms, sizes=(1, 5, 10, 25, 50, 100),
                       max_loss_probability=.10, max_tail_loss=D('25')):
    """Discovery + independent-seed validation of each tested candidate.

    `opportunities`: (id, ReviewedBasket, Limits, Assumptions) tuples.
    Ranking is by validation mean dollar P&L, subject to downside constraints.
    Results are alternatives, not a simultaneously executable portfolio.
    """
    if not 0 <= max_loss_probability <= 1 or not max_tail_loss.is_finite() or max_tail_loss < 0:
        raise ValueError('Invalid ranking risk constraint')
    if not 1 <= len(opportunities) <= 20 or not 1 <= len(sizes) <= 12:
        raise ValueError('Bound the opportunity/size search')
    if any(type(x) is not int or not 1 <= x <= 10000 for x in sizes):
        raise ValueError('Invalid candidate size')
    identifiers = [o[0] for o in opportunities]
    if any(not i for i in identifiers) or len(set(identifiers)) != len(identifiers):
        raise ValueError('Distinct opportunity identifiers required')
    candidates, rejected = [], []
    for identifier, basket, limits, assumptions in opportunities:
        seen = set()
        try:
            assumptions.validate(len(basket.scenarios))
            for size in sorted(set(sizes)):
                estimate = analyze(basket, replace(limits, max_quantity=min(size, limits.max_quantity)), now_ms)
                if estimate is None or estimate.quantity in seen:
                    continue
                seen.add(estimate.quantity)
                discovery = simulate(basket, estimate, assumptions)
                validation = simulate(basket, estimate, replace(assumptions, seed=assumptions.seed+1000003))
                expected = D(validation['mean_pnl'])
                acceptable = (expected > 0 and validation['loss_fraction'] <= max_loss_probability
                              and D(validation['mean_worst_5_percent_pnl']) >= -max_tail_loss)
                candidates.append({
                    'opportunity_id': identifier, 'quantity_per_leg': estimate.quantity,
                    'capital_bound': str(estimate.principal+estimate.fee_bound+estimate.slippage_reserve),
                    'expected_profit_dollars': str(expected),
                    'profit_p05_dollars': validation['p05_pnl'],
                    'profit_p95_dollars': validation['p95_pnl'],
                    'passes_risk_constraints': acceptable,
                    'discovery': discovery, 'validation': validation})
        except ValueError as exc:
            rejected.append({'opportunity_id': identifier, 'reason': str(exc)})
            candidates = [x for x in candidates if x['opportunity_id'] != identifier]
    candidates.sort(key=lambda x: D(x['expected_profit_dollars']), reverse=True)
    eligible = [x for x in candidates if x['passes_risk_constraints']]
    return {'objective': 'Highest modeled net dollar profit among tested alternatives within risk constraints',
            'selected': eligible[0] if eligible else None, 'ranked_candidates': candidates,
            'rejected': rejected, 'tested_size_caps': list(sizes),
            'limitations': 'Finite size grid; no global-optimum claim. Independent random seeds do not validate assumptions. Capital and liquidity overlap between alternatives; do not add their profits. No time-normalized return or portfolio allocation.'}
