# Kal Kings research engine

Python 3.11+, standard library only. Non-sports financial event-contract analysis and public crypto research. No trading credentials, real-money order placement, sportsbook adapters, GitHub Actions, or hosting dependencies.

## Run

From this directory:

```sh
python -m unittest discover -s tests -v
python -m kalresearch --demo
python -m kalresearch --demo --rank
python -m kalresearch.dashboard
```

The last command serves http://127.0.0.1:8765. Keep the process running and page open for 60-second refreshes. This is a local development dashboard, not a production internet server or deployed always-on service. BTC/USD and ETH/USD are the initial watchlist. Unsupported assets must be added with verified venue symbols and adapter tests.

## What the system actually does

* Event engine: evaluates reviewed buy-only, equal-unit baskets across explicit settlement scenarios. Uses exact decimal money, depth sweeps, conservative fees, slippage reserves, available cash limits, freshness and synchronized-snapshot checks.
* Monte Carlo: simulates fill failures, partial fills, a common outage, adverse price movement and settlement scenarios. Partial positions remain exposed through settlement; there is no assumed free hedge. Outputs mean net dollar profit, percentiles, loss frequency, tail loss and sampling-error intervals.
* Ranking: compares opportunity and size alternatives, runs discovery and separate-seed validation, then ranks validation dollar profit subject to loss/tail constraints. A finite size grid is used, not global optimization. Alternatives may compete for the same capital/liquidity and must not be added together.
* Crypto: public Coinbase Exchange, Kraken and Bitstamp candles; consistent USD pairs, completed hourly bars, synchronized endpoints and contiguous histories. Majority means observed 24-hour momentum among available exchanges. At least two exchanges and 72 common hours are required. It does not mean most traders expect a move.
* Crypto Monte Carlo: six-hour moving-block bootstrap of median exchange prices; 24-hour hypothetical long-only spot P&L on $1,000, ranked across BTC/ETH. Includes illustrative per-side 0.6% fees and 0.1% slippage, configurable in the Python function. This is directional risk analysis, not an arbitrage strategy or calibrated price prediction. Falling-price observations do not enable short selling.
* TradingView: optional official hosted chart widget with attribution, loaded on user click; no signup or API key in this application. It displays charts and is not an input feed for the engine. Third-party availability/restrictions still apply.
* Journal: optional append-only SQLite simulation records containing inputs and outputs. Not a brokerage ledger, positions system, or production database. No database hosting was changed.

## Event input and plug-in interface

`kalresearch.core.FinancialDataAdapter` defines the immutable snapshot interface. `KalshiPublic` implements public GET-only market reads. It requires verified economics/financials metadata, a reviewed full-rules digest, and externally verified fee parameters with expiry. It does not auto-discover equivalence or load credentials. New financial venue adapters must meet this contract; unsupported categories fail closed.

To create an input schema example without mistaking it for market data:

```sh
python -c "import json,time; from kalresearch.__main__ import demo; print(json.dumps(demo(int(time.time()*1000)),indent=2))" > example.json
python -m kalresearch --input example.json
```

`example.json` is synthetic and expires after two seconds by default. For real input, the integration agent must acquire fresh snapshots after rule/fee review. Decimal fields must be strings. Ranking accepts `{"opportunities":[{"id":"unique-name","snapshot":{...same schema...}}]}` with `--rank`.

Optional simulation record:

```sh
python -m kalresearch --demo --rank --journal runs.sqlite --run-id demo-001
```

Repeated identical journal payloads are idempotent; a reused ID with changed content is rejected. CLI runs include observation times, so a new run requires a new ID.

## Integration handoff / remaining work

This lane owns only `research_engine/` and the coordination note under `docs/`. No other agent session was reachable, and no acknowledgment has been received. The integration owner should:

1. Supply fresh financial-only snapshots, active status, series/event fee overrides and reviewed complete settlement matrices. The fee verifier is an upstream responsibility; unknown or stale schedules must never be passed as verified.
2. Keep rule hashes and evidence current. Same titles do not prove equivalent payouts. Include cancellation, revisions and unusual settlement cases where applicable.
3. Gather timestamped book updates and actual execution/rejection observations before calibrating fill, delay and slippage distributions. Estimate settlement probabilities independently of the opportunities being scored.
4. Validate on unseen historical periods and forward observations. Random seeds alone do not validate the model. Neither the demo nor the short crypto histories demonstrate live profitability.
5. Use an authenticated production application, durable worker and shared cache if deploying beyond localhost. Public API reachability and TradingView rendering must be checked on that host.

No funded trading has been enabled. No profitable live opportunity has been verified. See RESEARCH.md for evidence and model boundaries.
