"""Authenticated Kalshi readiness checks. No order submission or activation."""
import argparse
import base64
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

HOSTS={'production':'https://external-api.kalshi.com',
       'demo':'https://external-api.demo.kalshi.co'}
PATHS=frozenset({'/trade-api/v2/portfolio/balance','/trade-api/v2/exchange/status'})


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('Authenticated redirects are disabled')


def credentials(environ=None):
    env=os.environ if environ is None else environ
    key_id=env.get('KALSHI_API_KEY_ID','').strip()
    key_path=env.get('KALSHI_PRIVATE_KEY_PATH','').strip()
    key_pem=env.get('KALSHI_PRIVATE_KEY','').strip()
    if not key_id or not (key_path or key_pem):
        raise ValueError('Set KALSHI_API_KEY_ID and either KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH in the runtime environment')
    if key_path and key_pem:
        raise ValueError('Configure one private key source, not both')
    if any(c in key_id for c in '\r\n'):
        raise ValueError('Invalid API key identifier')
    try:
        raw=key_pem.replace('\\n','\n').encode() if key_pem else Path(key_path).read_bytes()
        key=serialization.load_pem_private_key(raw,password=None)
    except (OSError,ValueError,TypeError):
        raise ValueError('Private key could not be loaded; check the configured secret or file and PEM format') from None
    if not isinstance(key,(rsa.RSAPrivateKey,ed25519.Ed25519PrivateKey)):
        raise ValueError('Unsupported private key algorithm')
    return key_id,key


def signature(key,timestamp,path):
    message=f'{timestamp}GET{path.split("?")[0]}'.encode()
    if isinstance(key,ed25519.Ed25519PrivateKey):
        signed=key.sign(message)
    elif isinstance(key,rsa.RSAPrivateKey):
        signed=key.sign(message,padding.PSS(mgf=padding.MGF1(hashes.SHA256()),salt_length=hashes.SHA256().digest_size),hashes.SHA256())
    else:
        raise ValueError('Unsupported private key algorithm')
    return base64.b64encode(signed).decode()


def transport(request):
    try:
        with build_opener(NoRedirect()).open(request,timeout=10) as response:
            data=response.read(1_000_001)
            if len(data)>1_000_000:
                raise ValueError('Oversized response')
            return json.loads(data)
    except HTTPError as exc:
        raise ValueError(f'Kalshi returned HTTP {exc.code}; credentials and response body are not logged') from None
    except (URLError,TimeoutError):
        raise ValueError('Kalshi connection failed') from None


class Connection:
    def __init__(self,key_id,key,environment='demo',request_transport=transport,clock=None):
        if environment not in HOSTS:
            raise ValueError('Choose demo or production')
        self.key_id,self.key,self.environment=key_id,key,environment
        self.transport=request_transport
        self.clock=clock or (lambda:int(time.time()*1000))

    def get(self,path):
        if path not in PATHS:
            raise ValueError('Readiness endpoint not allowed')
        timestamp=str(self.clock())
        request=Request(HOSTS[self.environment]+path,method='GET',headers={
            'KALSHI-ACCESS-KEY':self.key_id,'KALSHI-ACCESS-TIMESTAMP':timestamp,
            'KALSHI-ACCESS-SIGNATURE':signature(self.key,timestamp,path),
            'User-Agent':'KalKings-Readiness/1.0'})
        return self.transport(request)

    def check(self):
        status=self.get('/trade-api/v2/exchange/status')
        balance=self.get('/trade-api/v2/portfolio/balance')
        # Successful authentication is not readiness to trade a specific market.
        if type(balance.get('balance')) is not int or balance['balance']<0:
            raise ValueError('Unexpected balance response')
        return {'environment':self.environment,'authentication':'verified',
                'exchange_active':status.get('exchange_active') is True,
                'trading_active':status.get('trading_active') is True,
                'balance_readable':True,'funds_present':balance['balance']>0,
                'live_automation_enabled':False,'orders_submitted':0,
                'remaining':['Reviewed non-sports strategy and fee schedule',
                             'Tested order integration and execution reconciliation',
                             'Explicit position, loss, and spending limits',
                             'Deployed worker with durable state and monitoring']}


def main():
    parser=argparse.ArgumentParser(description='Read-only Kalshi authentication and readiness check')
    parser.add_argument('--environment',choices=tuple(HOSTS),default=os.environ.get('KALSHI_ENVIRONMENT','demo'))
    args=parser.parse_args()
    try:
        key_id,key=credentials()
        print(json.dumps(Connection(key_id,key,args.environment).check(),indent=2))
    except ValueError as exc:
        parser.exit(2,f'Not connected: {exc}\n')


if __name__=='__main__':main()
