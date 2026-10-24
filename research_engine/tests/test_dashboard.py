import threading
import unittest
from unittest.mock import patch
from urllib.request import urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from kalresearch.dashboard import Cache, Handler
from kalresearch.core import D
from kalresearch.crypto import scan, bootstrap_profit

class DashboardTests(unittest.TestCase):
    def test_amount_changes_invalidate_cache(self):
        calls=[]
        cache=Cache(lambda capital:calls.append(capital) or {'amount':str(capital)})
        self.assertEqual(cache.get(D('100')),cache.get(D('100')))
        self.assertEqual(cache.get(D('200')),{'amount':'200'})
        self.assertEqual(calls,[D('100'),D('200')])

    def test_amount_bounds_fail_before_network(self):
        for value in ('NaN','Infinity','0','-1','1000001'):
            with self.assertRaises(ValueError):scan(capital=D(value))

    def test_requested_capital_reaches_simulation(self):
        result=bootstrap_profit([D('100')]*100,capital=D('250'),trials=100)
        self.assertEqual(result['capital_usd'],'250')
        self.assertEqual(result['expected_profit_dollars'],'-3.48')

    def test_http_amount_validation_and_forwarding(self):
        calls=[]
        cache=Cache(lambda capital:calls.append(capital) or {'assets':[]})
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        try:
            with patch('kalresearch.dashboard.CACHE',cache):
                with urlopen(base+'/api/crypto?capital=275.50') as r:self.assertEqual(r.status,200)
                self.assertEqual(calls,[D('275.50')])
                for query in ('capital=NaN','capital=','capital=1&capital=2','capital=-1','unexpected=1'):
                    with self.assertRaises(HTTPError) as caught:urlopen(base+'/api/crypto?'+query)
                    self.assertEqual(caught.exception.code,400)
                self.assertEqual(len(calls),1)
        finally:server.shutdown();server.server_close();thread.join()
