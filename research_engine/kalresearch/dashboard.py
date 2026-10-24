"""Local-only public-data dashboard: python -m kalresearch.dashboard."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from .crypto import scan


class Cache:
    def __init__(self, scanner=scan):
        self.lock=threading.Lock()
        self.data=None
        self.updated=0
        self.scanner=scanner

    def get(self):
        with self.lock:
            if self.data is None or time.monotonic()-self.updated>=60:
                self.data=self.scanner()
                self.updated=time.monotonic()
            return self.data


CACHE=Cache()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path=='/':
            body=Path(__file__).with_name('dashboard.html').read_bytes()
            content='text/html; charset=utf-8'
        elif self.path=='/api/crypto':
            try:
                body=json.dumps(CACHE.get(),allow_nan=False).encode()
            except Exception:
                self.send_error(503,'Market data unavailable')
                return
            content='application/json'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type',content)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(body)


if __name__=='__main__':
    print('Kal Kings research dashboard: http://127.0.0.1:8765 (Ctrl-C to stop)',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8765),Handler).serve_forever()
