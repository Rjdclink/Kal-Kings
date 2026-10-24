import unittest
from dataclasses import replace
from kalresearch.core import D
from kalresearch.depth import Book, fetch_book, levels, quote_buy
from kalresearch.crypto import bootstrap_profit


class DepthTests(unittest.TestCase):
    def setUp(self):
        self.book=Book('test','BTC',100,101,((D('99'),D('10')),),((D('100'),D('1')),(D('110'),D('2'))))

    def test_sweep_and_visible_depth(self):
        quote=quote_buy(self.book,D('210'),102)
        self.assertEqual(D(quote['estimated_base_quantity']),D('2'))
        self.assertEqual(D(quote['estimated_vwap_usd']),D('105'))
        self.assertEqual(D(quote['visible_ask_notional_usd']),D('320'))
        self.assertEqual(quote['execution_status'],'UNCONFIRMED_PUBLIC_SNAPSHOT')

    def test_thin_stale_and_future_books_rejected(self):
        for budget,now in [(D('400'),102),(D('100'),106),(D('100'),99)]:
            with self.assertRaises(ValueError): quote_buy(self.book,budget,now)

    def test_reject_duplicate_or_invalid_levels(self):
        for rows in ([],[['100','0']],[['100','1'],['100','2']],[['NaN','1']]):
            with self.assertRaises(ValueError): levels(rows)

    def test_adapter_rejects_crossed_book(self):
        with self.assertRaises(ValueError): fetch_book('coinbase','BTC',lambda _: {'bids':[['101','1']],'asks':[['100','1']]})

    def test_adapter_preserves_exact_prices(self):
        book=fetch_book('coinbase','BTC',lambda _: {'bids':[['99.12345678','1']],'asks':[['100.12345678','1']]},clock=lambda:100)
        self.assertEqual(book.asks[0][0],D('100.12345678'))

    def test_observed_entry_cost_affects_profit(self):
        prices=[D('100')]*100
        low=bootstrap_profit(prices,trials=100,entry_slippage_rate=D('.001'))
        high=bootstrap_profit(prices,trials=100,entry_slippage_rate=D('.02'))
        self.assertGreater(D(low['expected_profit_dollars']),D(high['expected_profit_dollars']))
