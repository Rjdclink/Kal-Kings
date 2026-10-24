import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from kalresearch.core import D, Fees, Level, Limits, analyze, decimal, sweep
from kalresearch.__main__ import demo, load
from kalresearch.kalshi import KalshiPublic, normalize_book, rules_digest
from kalresearch.monte_carlo import simulate
from kalresearch.paper import record
from kalresearch.ranking import rank_opportunities

NOW = 100000


class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.basket, self.limits, self.assumptions = load(demo(NOW))
        self.assumptions = replace(self.assumptions, trials=200)

    def changed_leg(self, **changes):
        return replace(self.basket, snapshots=(replace(self.basket.snapshots[0], **changes), self.basket.snapshots[1]))

    def test_exact_decimal_and_nonfinite_rejection(self):
        self.assertEqual(decimal('.1') + decimal('.2'), D('.3'))
        for bad in (float('.1'), True, 'NaN', 'Infinity'):
            with self.assertRaises(ValueError): decimal(bad)

    def test_fixed_point_book_complements(self):
        payload = {'orderbook_fp': {'no_dollars': [['.5001', '3.25'], ['.6', '2.00']], 'yes_dollars': []}}
        result = normalize_book(payload, 'yes')
        self.assertEqual(result, (Level(D('.4'), D('2')), Level(D('.4999'), D('3.25'))))

    def test_reject_invalid_book(self):
        for p,q in [('.4', '-1'), ('1.01', '1'), ('.12345','1'), ('.2','.001')]:
            with self.assertRaises(ValueError): Level(D(p), D(q))

    def test_depth_aware_cost(self):
        s = replace(self.basket.snapshots[0], asks=(Level(D('.1'), D('2')), Level(D('.8'), D('3'))))
        self.assertEqual(sweep(s, 4)[0], D('1.8'))
        with self.assertRaises(ValueError): sweep(s, 6)

    def test_best_size_stops_before_bad_depth(self):
        basket = self.changed_leg(asks=(Level(D('.40'), D('5')), Level(D('.9'), D('95'))))
        self.assertEqual(analyze(basket, self.limits, NOW).quantity, 5)

    def test_fee_upper_bound_includes_fragmentation(self):
        fee = self.basket.snapshots[0].fees
        self.assertGreater(fee.upper_bound(D('.5'), D('100')), D('1.75'))
        self.assertGreater(replace(fee, balance_quantum=D('.01')).upper_bound(D('.5'), D('100')), fee.upper_bound(D('.5'), D('100')))

    def test_stale_future_and_skew_rejected(self):
        for timestamp in (NOW-2001, NOW+1, NOW-501):
            with self.assertRaises(ValueError): analyze(self.changed_leg(observed_ms=timestamp), self.limits, NOW)

    def test_unknown_sports_and_mixed_category_rejected(self):
        for category in ('sports', '', 'Sports', 'unknown'):
            with self.assertRaises(ValueError): analyze(self.changed_leg(category=category), self.limits, NOW)

    def test_expired_fee_rejected(self):
        fees = replace(self.basket.snapshots[0].fees, verified_until_ms=NOW)
        with self.assertRaises(ValueError): analyze(self.changed_leg(fees=fees), self.limits, NOW)

    def test_unhealthy_and_inactive_rejected(self):
        for change in ({'healthy': False}, {'active': False}):
            with self.assertRaises(ValueError): analyze(self.changed_leg(**change), self.limits, NOW)

    def test_unreviewed_matrix_and_duplicate_leg_rejected(self):
        for basket in (replace(self.basket, exhaustive=False), replace(self.basket, review_reference=''), replace(self.basket, snapshots=(self.basket.snapshots[0],)*2)):
            with self.assertRaises(ValueError): analyze(basket, self.limits, NOW)

    def test_missing_settlement_coverage_eliminates_edge(self):
        b = replace(self.basket, scenarios=(*self.basket.scenarios, 'both lose'), payoffs=(*self.basket.payoffs, (D('0'), D('0'))))
        self.assertIsNone(analyze(b, self.limits, NOW))

    def test_budget_and_per_venue_cash(self):
        estimate = analyze(self.basket, replace(self.limits, budget=D('5')), NOW)
        self.assertLessEqual(sum(v for _,v in estimate.venue_debits), D('5'))
        self.assertIsNone(analyze(self.basket, self.limits, NOW, balances={'synthetic': D('.10')}))

    def test_no_edge(self):
        self.assertIsNone(analyze(self.changed_leg(asks=(Level(D('.7'),D('100')),)), self.limits, NOW))

    def test_monte_carlo_reproducible(self):
        estimate = analyze(self.basket, self.limits, NOW)
        self.assertEqual(simulate(self.basket, estimate, self.assumptions), simulate(self.basket, estimate, self.assumptions))

    def test_perfect_fills_match_enumerated_settlement(self):
        estimate = analyze(self.basket, self.limits, NOW)
        assumptions = replace(self.assumptions, fill_probability=1, partial_probability=0, outage_probability=0, max_adverse_move='0', scenario_probabilities=(1,0,0))
        result = simulate(self.basket, estimate, assumptions)
        expected = D(estimate.quantity) - estimate.principal - estimate.fee_bound
        self.assertEqual(D(result['mean_pnl']), expected.quantize(D('.000001')))
        self.assertEqual(result['full_fill_fraction'], 1)

    def test_total_outage_produces_no_profit(self):
        result = simulate(self.basket, analyze(self.basket,self.limits,NOW), replace(self.assumptions,outage_probability=1))
        self.assertEqual(D(result['mean_pnl']), 0)
        self.assertEqual(result['no_fill_fraction'], 1)

    def test_leg_failures_create_loss_risk(self):
        result = simulate(self.basket, analyze(self.basket,self.limits,NOW), replace(self.assumptions,fill_probability=.5,partial_probability=0,scenario_probabilities=(1,0,0)))
        self.assertGreater(result['loss_fraction'], 0)
        self.assertLess(D(result['worst_trial_pnl']), 0)

    def test_probability_validation(self):
        with self.assertRaises(ValueError): replace(self.assumptions,scenario_probabilities=(.1,.1,.1)).validate(3)

    def test_journal_idempotency(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory)/'runs.sqlite')
            self.assertTrue(record(path,'run',{'profit':'1'}))
            self.assertFalse(record(path,'run',{'profit':'1'}))
            with self.assertRaises(ValueError): record(path,'run',{'profit':'2'})

    def test_ranking_dollars_and_validation_seed(self):
        assumptions = replace(self.assumptions,fill_probability=1,partial_probability=0,outage_probability=0,max_adverse_move='0',scenario_probabilities=(1,0,0))
        output = rank_opportunities([('economic-thresholds',self.basket,self.limits,assumptions)], NOW, sizes=(1,5,10))
        selected = output['selected']
        self.assertEqual(selected['quantity_per_leg'], 10)
        self.assertNotEqual(selected['discovery']['seed'], selected['validation']['seed'])
        profits = [D(x['expected_profit_dollars']) for x in output['ranked_candidates']]
        self.assertEqual(profits, sorted(profits,reverse=True))

    def test_ranking_rejects_high_loss_candidate(self):
        output = rank_opportunities([('economic-thresholds',self.basket,self.limits,replace(self.assumptions,fill_probability=.5))], NOW, sizes=(5,),max_loss_probability=0)
        self.assertIsNone(output['selected'])

    def test_adapter_reads_only_and_matches_rules(self):
        market = dict(ticker='CPI',event_ticker='CPI-E',market_type='binary',rules_primary='Official economic release',rules_secondary='',expiration_time='2027-01-01',status='active')
        calls=[]
        def transport(url):
            calls.append(url)
            if url.endswith('/orderbook'): return {'orderbook_fp': {'yes_dollars': [], 'no_dollars': [['.6','10']]}}
            if '/markets/' in url: return {'market':market}
            if '/events/' in url: return {'event':{'series_ticker':'CPI'}}
            return {'series':{'category':'Economics'}}
        adapter=KalshiPublic(transport=transport,clock=lambda: NOW,sleep=lambda _:None)
        result=adapter.snapshot('CPI','yes',category='economics',expected_rules_hash=rules_digest(market),fees=self.basket.snapshots[0].fees)
        self.assertEqual(result.asks[0].price,D('.4'))
        self.assertEqual(len(calls),4)
        with self.assertRaises(ValueError): adapter.get('/portfolio/orders')
        with self.assertRaises(ValueError): adapter.snapshot('CPI','yes',category='economics',expected_rules_hash='bad',fees=self.basket.snapshots[0].fees)


if __name__ == '__main__':
    unittest.main()
