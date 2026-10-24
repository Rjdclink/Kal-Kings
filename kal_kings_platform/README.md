# Kal Kings | Sports, crypto and prediction market dashboard

Deployment: Neon `kalkingsdashboard` serverless function (Node.js 24), not Railway or GitHub Actions.

The dashboard asks the server every 3 seconds for a fresh state response. **That is not a guarantee that provider quotes update every 3 seconds.** Each provider's own updated timestamp is displayed. Market-data caches: Kalshi 3 seconds, Polymarket US 8 seconds, Coinbase crypto 12 seconds, Kalshi account 6 seconds. DraftKings uses a connected SharpAPI sportsbook-odds relay by default, with an optional separately configured The Odds API feed. The odds relay is read only and may be delayed by its provider. The dashboard polls every 3 seconds while open; the DraftKings relay is cached for 60 seconds by default to respect upstream limits. Setting this lower without sufficient purchased requests will hit provider limits. Sports quoteboards show ten distinct games per venue when available; the backend samples up to 200 quotes across eight Kalshi sports series and three Polymarket US pages. Crypto references show up to BTC, ETH, SOL, XRP, DOGE, and ADA quoted by Coinbase Exchange. TradingView links open charts; TradingView is *not* a prediction feed.

Main views: unverified **Price gaps** (possible quote mismatches across venues that require outcome/rules review), **Verified** (recorded market-rule mappings with positive conditional quoted profit; still requires both legs to execute), **Value signals** (reference-only probabilities), **Favorites** (market-implied favorites, not proven positive-EV). Model results or quotes alone do not guarantee realized profit. The interface intentionally shows fewer than 10 opportunities if there are fewer valid matches, and never manufactures prices.

**Bankroll tracking is enabled**, even if both accounts have zero available funds. Kalshi's available balance/holdings are read through its authenticated API; DraftKings balance is entered and updated in Neon PostgreSQL. Accepted DraftKings wagers debit the tracked bankroll; confirmed settlements credit actual payouts. A market quote or an unfilled order never changes available bankroll or P&L. Kalshi can automatically submit a fill-or-kill YES-side hedge **after** you record an accepted DraftKings wager linked to an explicitly reviewed opposite-outcome pair. The system records only exchange-confirmed fills as executed; errors and uncertain execution states are not automatically retried. This is not an always-on autonomous scanner and does not claim independent trade alpha. Unfunded opportunity quotes may still be shown for analysis, always clearly marked as unfunded and not executable. The bankroll-aware strategy uses a gradually increasing risk rate (0.75%–2.5%) with a $25 absolute ceiling for both hard and worst-5% tail-loss tolerance, separately subject to actual available cash and liquidity. Inputs for Monte Carlo are assumptions, not independently calibrated predictions.

The optional AI briefing loads an open ONNX model **on the user's device** only when the user presses `Generate briefing` (no API keys or sign-up). Four six-hour UTC shifts, rotating once every six hours:

1. Qwen2.5-0.5B-Instruct: concise sports quote / contract wording check.
2. SmolLM2-360M-Instruct: concise crypto context.
3. Qwen3-0.6B: challenge trade assumptions and risk narratives.
4. SmolLM2-135M-Instruct: produce short operational briefs.

All are publicly downloadable open models; their first downloads may be large and local inference may fail on constrained browsers. There are **no hosted cloud inference credits** and *no always-on LLM agent* in this Neon setup. Deterministic formulas, not LLM outputs, are responsible for financial numbers. Free, anonymous hosted APIs offering guaranteed unlimited 24/7 high-quality inference could not be established, so this approach does not pretend those exist. Models have no access to API credentials and cannot submit orders.

Neon function environment must contain `KALKINGS_ADMIN_TOKEN` (32+ characters), `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY`, `KALSHI_ENVIRONMENT=production`; optionally `POLYMARKET_KEY_ID`, `POLYMARKET_SECRET_KEY`, `ODDS_API_KEY`, `ODDS_POLL_MS`. Neon provides `DATABASE_URL` in supported runtimes; confirm with `/health?probe=1` and a protected `/api/state` call. GitHub variables do not automatically populate Neon env. API requests are token-gated; no secrets are stored in the client or repository.

**Known limitations:** The 3-second dashboard request cycle depends on a browser being open. Neon Functions are request-driven, not an always-on 3-second trading loop. DraftKings betting remains manual because the SharpAPI key is an ODDS key, not a sportsbook-wagering key. Kalshi auto-hedging requires confirmed manual DraftKings ticket, exact reviewed pairing, positive net outcome on both sides, sufficient free cash, up-to-date Kalshi quote, and an idempotent audit row. There is no always-on order worker and no independently calibrated live-execution profit model. The conservative display does not show false positive trades when unverified or stale. Unfunded accounts remain nontrading by design.

Run tests locally from `kal_kings_platform/` with:

```bash
node --test test.mjs test_server.mjs strategy.test.mjs feeds.test.mjs agents.test.mjs candidate.test.mjs
```

Neon deployment bundle requires `index.mjs`, `engine.mjs`, `strategy.mjs`, `sports.mjs`, `agents.mjs`, `feeds.mjs`, `dashboard.html` at the ZIP root. The repository also includes `schema.sql` and tests. Keep `research_engine/` untouched to avoid conflicts with its owner.

## Live sports feed repair and diagnosis

The dashboard independently confirms which feeds have live records. `/health?probe=1` exposes aggregate record counts and status without returning account data or keys. Polymarket US now uses the real `marketSides[].quote.value` bid/ask-side quote fields and `updatedAt` (rather than `ep3SyncedAt`, which is metadata synchronization). Expired sports markets are excluded. Snapshot freshness is determined by when the quote was fetched; the provider's last-change timestamp remains visible separately. Cross-exchange comparisons require the same named event **and** the same outcome side, and stay labeled REVIEW_ONLY until settlement rules, fees, liquidity, and execution are verified.

DraftKings data cannot be synthesized from Kalshi/Polymarket. An odds-data provider API key must be connected through the dashboard; for a blank account the feed is deliberately displayed as **Needs odds API key**. A 3-second page refresh does not make a rate-limited DraftKings source update every three seconds. The app will not invent ten profitable opportunities if none can be substantiated.

`feedDiagnostics` in `/api/state` includes provider counts, crypto counts, reviewed-pair counts, and explanatory status. Unreviewed market-name matches never autoexecute or consume capital. The Neon function remains a request-triggered scanner, not a 24/7 background trading worker, and does not submit real-money orders.

## TradingView signal integration

Crypto now has two separately labeled sources: live Coinbase reference prices and completed-hour Coinbase technical trends; authentic TradingView signals arrive only through user-configured TradingView alert POST requests. Add a 24+ character passphrase in Dashboard → Data feed settings → TradingView alert signals, and configure TradingView alerts to POST JSON to `<Neon-dashboard-origin>/webhooks/tradingview`. Use the passphrase in the JSON body with `ticker`, `action`, `close`, and `time`. Supported tickers BTC, ETH, SOL, XRP, DOGE, ADA. The webhook stores recent deduplicated alerts in Neon PostgreSQL, lists them in `/api/state` and marks them as advisory only. This does not claim that TradingView exposes an open price-prediction API or that charts are independent forecasts. Account-changing endpoints still require the administrator token.

Only actual provider-confirmed prices and configured inputs can create cross-venue observations. Missing DraftKings odds provider credentials or missing reviewed settlement mappings are explicit feed limitations; the app does not manufacture qualifying trade prices. Neon Functions' request/response hosting does not by itself provide a 24/7 sub-second autonomous trade daemon.


## Kalshi auto-hedge execution (conditional)

When the user records a **real accepted DraftKings wager** from a reviewed Kalshi/DraftKings pairing, the server checks the live Kalshi contract and current available balance, sizes the YES-side hedge according to its bankroll loss cap and fee estimate, and if both settlement payouts are still profitable, submits a `fill_or_kill` order via Kalshi V2 API. It stores a unique client order ID and the Kalshi result in Neon. It never assumes a DraftKings wager has executed based on a quote alone, and it never submits a DraftKings wager. If the Kalshi response is ambiguous, it does not automatically retry.

SharpAPI provides publicly sourced DraftKings odds through the independent Neon `sharpapifeed` service. The SharpAPI key itself never leaves that service. The relay currently returns a limited, delayed sample; it is not a 3-second live in-play wagering feed. Market names and outcomes must be reviewed against complete settlement rules before orders can be considered. No orders are submitted unless the account has funds and all pairing checks pass.

`orders.mjs` contains the fail-closed hedge planner and V2 order specification; `sharp.mjs` normalizes odds, groups per-selection records into event-level markets without treating one team as a full two-way quote, and never exposes a bet-placement method. `automation-schema.sql` adds the idempotent order ledger and optional reviewed-pair association to DraftKings tickets.
