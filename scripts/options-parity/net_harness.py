"""Run scripts/options-data.py with the network replaced by recorded fixtures.

usage: FIXTURES=f.json REQLOG=log python net_harness.py <path/to/options-data.py>

Patches requests.get and yfinance YfData.get, so everything above the HTTP layer is the
unmodified script and yfinance. The request keys match net-preload.ts. yfinance's own
retry and cookie-strategy logic lives below YfData.get and is therefore NOT exercised here.
Temporary tool: delete together with options-data.py.
"""
import base64
import json
import os
import runpy
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

FIX = json.load(open(os.environ["FIXTURES"]))
REQLOG = os.environ.get("REQLOG")


def key_of(url, params=None):
    u = urlsplit(url)
    pairs = list(parse_qsl(u.query, keep_blank_values=True))
    if params:
        pairs += [(k, str(v)) for k, v in params.items()]
    pairs = sorted(f"{k}={v.lower() if k == 'includePrePost' else v}" for k, v in pairs if k != "crumb")
    return f"{u.scheme}://{u.netloc}{unquote(u.path)}" + ("?" + "&".join(pairs) if pairs else "")


def log(line):
    if REQLOG:
        with open(REQLOG, "a") as f:
            f.write(line + "\n")


class Resp:
    def __init__(self, hit, url):
        self.status_code = hit["status"]
        self.content = base64.b64decode(hit["b64"])
        self._enc = hit["enc"]
        self.url = url
        self.headers = {}

    @property
    def text(self):
        return self.content.decode("latin-1" if self._enc == "latin1" else "utf-8")

    def json(self):
        return json.loads(self.content.decode("utf-8"))

    def raise_for_status(self):
        if self.status_code >= 400:
            import http
            import requests
            kind = "Client" if self.status_code < 500 else "Server"
            raise requests.HTTPError(f"{self.status_code} {kind} Error: {http.HTTPStatus(self.status_code).phrase} for url: {self.url}")


def serve(url, params=None):
    k = key_of(url, params)
    if k not in FIX and "/v8/finance/chart/" in k and k.endswith("?interval=1d&range=1d"):
        # yfinance looks the exchange timezone up on a cold tz cache (Ticker.tz) with the same chart
        # call minus the events param. Serve the recorded chart of the real call, tag it so the
        # request sequence diff can ignore it. It does not change the output.
        alt = k.replace("?interval=1d&range=1d", "?events=div,splits,capitalGains&includePrePost=false&interval=1d&range=1d")
        log("TZLOOKUP " + k)
        if alt in FIX:
            return Resp(FIX[alt], url)
    log(k)
    if k not in FIX:
        log("MISSING " + k)
        raise RuntimeError("no fixture for " + k)
    return Resp(FIX[k], url)


import requests  # noqa: E402

requests.get = lambda url, headers=None, timeout=None, params=None, **kw: serve(url, params)

from yfinance.data import YfData  # noqa: E402

YfData.get = lambda self, url, params=None, timeout=30: serve(url, params)

script = sys.argv[1]
sys.argv = [script]
runpy.run_path(script, run_name="__main__")
