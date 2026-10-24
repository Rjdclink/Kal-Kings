import unittest
from kalresearch.core import D
from kalresearch.crypto import Candle, bootstrap_profit, consensus, fetch_candles, scan
from kalresearch.dashboard import Cache

NOW=400*3600


def history(growth='1.001'):
    return tuple(Candle(t*3600,D('100')*D(growth)**(t-300)) for t in range(300,400))


class CryptoTests(unittest.TestCase):
    def test_up_consensus(self):
        result,prices=consensus({'a':history(),'b':history(),'c':history('.999')},NOW)
        self.assertEqual(result['direction'],'up')
        self.assertEqual(result['agreeing_venues'],2)
        self.assertEqual(len(prices),100)

    def test_disagreement_is_not_majority(self):
        result,_=consensus({'a':history(),'b':history('.999')},NOW)
        self.assertEqual(result['direction'],'mixed')

    def test_stale_and_gapped_histories_fail_closed(self):
        with self.assertRaises(ValueError): consensus({'a':history()[:-1],'b':history()},NOW)
        gapped=history()[:50]+history()[51:]
        with self.assertRaises(ValueError): consensus({'a':gapped,'b':gapped},NOW)

    def test_unfinished_coinbase_candle_removed(self):
        rows=[[NOW,0,0,0,999,1],[NOW-3600,0,0,0,100,1]]
        result=fetch_candles('coinbase','BTC',NOW,lambda _:rows)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0].close,D('100'))

    def test_kraken_and_bitstamp_shapes(self):
        kraken={'error':[],'result':{'XXBTZUSD':[[NOW-3600,'1','1','1','10','1','1',1]],'last':NOW}}
        stamp={'data':{'ohlc':[{'timestamp':str(NOW-3600),'close':'10'}]}}
        self.assertEqual(fetch_candles('kraken','BTC',NOW,lambda _:kraken),fetch_candles('bitstamp','BTC',NOW,lambda _:stamp))

    def test_flat_price_loses_costs(self):
        report=bootstrap_profit([D('100')]*100,trials=100)
        expected=D('1000')*(D('.993')/D('1.007')-1)
        self.assertEqual(D(report['expected_profit_dollars']),expected.quantize(D('.01')))
        self.assertEqual(report['loss_fraction'],1)

    def test_seed_reproducible(self):
        prices=[c.close for c in history()]
        self.assertEqual(bootstrap_profit(prices,trials=100),bootstrap_profit(prices,trials=100))

    def test_invalid_prices_and_parameters_rejected(self):
        for prices in ([D('0')]*100,[D('NaN')]*100,[D('100')]*10):
            with self.assertRaises(ValueError): bootstrap_profit(prices,trials=100)
        with self.assertRaises(ValueError): bootstrap_profit([D('100')]*100,fee_rate=D('-.1'))

    def test_failed_sources_never_return_synthetic_data(self):
        def fail(_): raise ConnectionError('offline')
        report=scan(transport=fail,now=NOW)
        self.assertTrue(all(a['status']=='UNAVAILABLE' and 'forecast' not in a for a in report['assets']))

    def test_request_cache(self):
        calls=[]
        cache=Cache(lambda:calls.append(1) or {'ok':True})
        self.assertEqual(cache.get(),cache.get())
        self.assertEqual(len(calls),1)


if __name__=='__main__': unittest.main()
