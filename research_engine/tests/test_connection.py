import base64
import unittest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ed25519,padding,rsa
from kalresearch.connection import Connection,credentials,signature


class ConnectionTests(unittest.TestCase):
    def test_both_documented_algorithms_and_query_exclusion(self):
        keys=[ed25519.Ed25519PrivateKey.generate(),rsa.generate_private_key(public_exponent=65537,key_size=2048)]
        for key in keys:
            raw=base64.b64decode(signature(key,'123','/trade-api/v2/portfolio/balance?x=1'))
            message=b'123GET/trade-api/v2/portfolio/balance'
            if isinstance(key,ed25519.Ed25519PrivateKey):key.public_key().verify(raw,message)
            else:key.public_key().verify(raw,message,padding.PSS(mgf=padding.MGF1(hashes.SHA256()),salt_length=32),hashes.SHA256())

    def test_missing_credentials(self):
        with self.assertRaises(ValueError):credentials({})

    def test_readiness_no_orders_or_sensitive_output(self):
        calls=[]
        def transport(request):
            calls.append(request)
            return {'balance':10000} if request.full_url.endswith('balance') else {'exchange_active':True,'trading_active':True}
        connection=Connection('test-id',ed25519.Ed25519PrivateKey.generate(),'production',transport,lambda:123)
        result=connection.check()
        self.assertEqual(len(calls),2)
        self.assertTrue(all(r.method=='GET' for r in calls))
        self.assertFalse(result['live_automation_enabled'])
        self.assertNotIn('balance',result)
        self.assertEqual(result['authentication'],'verified')
        with self.assertRaises(ValueError):connection.get('/trade-api/v2/portfolio/orders')

    def test_untrusted_host_rejected(self):
        with self.assertRaises(ValueError):Connection('test',ed25519.Ed25519PrivateKey.generate(),'https://other.example')
