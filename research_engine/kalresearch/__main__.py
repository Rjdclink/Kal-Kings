"""CLI: python -m kalresearch --demo; or --input reviewed_snapshot.json."""
import argparse
from decimal import InvalidOperation
from dataclasses import asdict
import json
import time
from .core import D, Fees, Level, Limits, ReviewedBasket, Snapshot, analyze, decimal
from .monte_carlo import Assumptions, simulate
from .paper import record
from .ranking import rank_opportunities


def load(data):
    snapshots = []
    for raw in data['legs']:
        fees = raw['fees']
        snapshots.append(Snapshot(
            raw['venue'], raw['ticker'], raw['side'], raw['category'], raw['rules_hash'], raw['observed_ms'],
            tuple(Level(decimal(p), decimal(q)) for p,q in raw['asks']),
            Fees(decimal(fees['coefficient']), decimal(fees['multiplier']), decimal(fees['balance_quantum']), fees['verified_until_ms'], fees['source']),
            raw.get('active', False) is True, raw.get('healthy', False) is True))
    basket = ReviewedBasket(tuple(snapshots), tuple(data['scenarios']), tuple(tuple(decimal(x) for x in row) for row in data['payoffs']), data['review_reference'], data.get('exhaustive') is True)
    raw = dict(data.get('limits', {}))
    for key in ('budget', 'min_profit', 'slippage_per_contract'):
        if key in raw:
            raw[key] = decimal(raw[key])
    assumptions = dict(data['monte_carlo'])
    assumptions['scenario_probabilities'] = tuple(assumptions['scenario_probabilities'])
    return basket, Limits(**raw), Assumptions(**assumptions)


def demo(now):
    # Deliberately synthetic related economic thresholds; never presented as live.
    legs = []
    for ticker, side, price in [('SYNTHETIC-CPI-ABOVE-2', 'yes', '.40'), ('SYNTHETIC-CPI-ABOVE-3', 'no', '.45')]:
        legs.append(dict(venue='synthetic', ticker=ticker, side=side, category='economics', rules_hash='DEMO-NOT-REVIEWED-LIVE', observed_ms=now, asks=[[price, '100']], active=True, healthy=True, fees=dict(coefficient='.07', multiplier='1', balance_quantum='.0001', verified_until_ms=now+60000, source='Illustrative quadratic fee parameters')))
    return dict(legs=legs, scenarios=['CPI <= 2', '2 < CPI <= 3', 'CPI > 3'], payoffs=[['0','1'],['1','1'],['1','0']], review_reference='SYNTHETIC DEMONSTRATION ONLY', exhaustive=True, limits=dict(budget='100', max_quantity=100), monte_carlo=dict(trials=5000, seed=20261024, fill_probability=.97, partial_probability=.08, outage_probability=.02, max_adverse_move='.03', scenario_probabilities=[.4,.2,.4], provenance='ILLUSTRATIVE: not fitted to historical data'))


def main():
    parser = argparse.ArgumentParser(description='Non-sports financial contract research; no real orders')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--demo', action='store_true')
    group.add_argument('--input')
    parser.add_argument('--journal', help='Optional local SQLite simulation journal')
    parser.add_argument('--run-id', help='Required with --journal')
    parser.add_argument('--rank', action='store_true', help='Rank opportunities and trade-size alternatives by simulated dollar profit')
    args = parser.parse_args()
    now = int(time.time()*1000)
    try:
        if args.demo:
            data = demo(now)
        else:
            with open(args.input) as f:
                data = json.load(f)
        if args.rank:
            entries = data.get('opportunities', [{'id': 'demo' if args.demo else 'input', 'snapshot': data}])
            opportunities = [(entry['id'], *load(entry['snapshot'])) for entry in entries]
            output = {'mode': 'SYNTHETIC_DEMO' if args.demo else 'SNAPSHOT_RESEARCH',
                      'analyzed_at_ms': now, 'ranking': rank_opportunities(opportunities, now)}
        else:
            basket, limits, assumptions = load(data)
            estimate = analyze(basket, limits, now)
            output = {'mode': 'SYNTHETIC_DEMO' if args.demo else 'SNAPSHOT_RESEARCH', 'analyzed_at_ms': now,
                      'estimate': asdict(estimate) if estimate else None,
                      'simulation': simulate(basket, estimate, assumptions) if estimate else None,
                      'status': 'CONDITIONAL_CANDIDATE' if estimate else 'NO_CANDIDATE'}
        # Decimal output always strings, never silently converted to binary float.
        serializable = json.loads(json.dumps(output, default=str, allow_nan=False))
        if args.journal:
            record(args.journal, args.run_id, {'input': data, 'output': serializable})
        print(json.dumps(serializable, indent=2))
    except (ValueError, KeyError, TypeError, OSError, InvalidOperation) as exc:
        parser.exit(2, f'Rejected: {exc}\n')


if __name__ == '__main__':
    main()
