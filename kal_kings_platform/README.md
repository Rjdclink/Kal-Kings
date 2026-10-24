# Kal Kings | Sports, crypto and prediction market dashboard

Deployment: Neon `kalkingsdashboard` serverless function (Node.js 24), not Railway or GitHub Actions.

The dashboard asks the server every 3 seconds for a fresh state response. **That is not a guarantee that provider quotes update every 3 seconds.** Each provider's own updated timestamp is displayed. Market-data caches: Kalshi 3 seconds, Polymarket US 8 seconds, Coinbase crypto 12 seconds, Kalshi account 6 seconds. DraftKings uses The Odds API when an odds-data key is configured. **Default DraftKings upstream polling is 6 hours**, avoiding exhaustion of the typical free provider allowance; paid accounts can configure `ODDS_POLL_MS=3000` or another allowed interval. Setting this lower without sufficient purchased requests will hit provider limits. Sports quoteboards show ten distinct games per venue when available; the backend samples up to 200 quotes across eight Kalshi sports series and three Polymarket US pages. Crypto references show up to BTC, ETH, SOL, XRP, DOGE, and ADA quoted by Coinbase Exchange. TradingView links open charts; TradingView is *not* a prediction feed.

Main views: unverified **Price gaps** (possible quote mismatches across venues that require outcome/rules review), **Verified** (recorded market-rule mappings with positive conditional quoted profit; still requires both legs to execute), **Value signals** (reference-only probabilities), **Favorites** (market-implied favorites, not proven positive-EV). Model results or quotes alone do not guarantee realized profit. The interface intentionally shows fewer than 10 opportunities if there are fewer valid matches, and never manufactures prices.

**Bankroll tracking is enabled**, even if both accounts have zero available funds. Kalshi's available balance/holdings are read through its authenticated API; DraftKings balance is entered and updated in Neon PostgreSQL. Accepted DraftKings wagers debit the tracked bankroll; confirmed settlements credit actual payouts. A market quote or an unfilled order never changes available bankroll or P&L. Live Kalshi execution is **not** enabled by this build. Unfunded opportunity quotes may still be shown for analysis, always clearly marked as unfunded and not executable. The bankroll-aware strategy uses a gradually increasing risk rate (0.75%–2.5%) with a $25 absolute ceiling for both hard and worst-5% tail-loss tolerance, separately subject to actual available cash and liquidity. Inputs for Monte Carlo are assumptions, not independently calibrated predictions.

The optional AI briefing loads an open ONNX model **on the user's device** only when the user presses `Generate briefing` (no API keys or sign-up). Four six-hour UTC shifts, rotating once every six hours:

1. Qwen2.5-0.5B-Instruct: concise sports quote / contract wording check.
2. SmolLM2-360M-Instruct: concise crypto context.
3. Qwen3-0.6B: challenge trade assumptions and risk narratives.
4. SmolLM2-135M-Instruct: produce short operational briefs.

All are publicly downloadable open models; their first downloads may be large and local inference may fail on constrained browsers. There are **no hosted cloud inference credits** and *no always-on LLM agent* in this Neon setup. Deterministic formulas, not LLM outputs, are responsible for financial numbers. Free, anonymous hosted APIs offering guaranteed unlimited 24/7 high-quality inference could not be established, so this approach does not pretend those exist. Models have no access to API credentials and cannot submit orders.

Neon function environment must contain `KALKINGS_ADMIN_TOKEN` (32+ characters), `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY`, `KALSHI_ENVIRONMENT=production`; optionally `POLYMARKET_KEY_ID`, `POLYMARKET_SECRET_KEY`, `ODDS_API_KEY`, `ODDS_POLL_MS`. Neon provides `DATABASE_URL` in supported runtimes; confirm with `/health?probe=1` and a protected `/api/state` call. GitHub variables do not automatically populate Neon env. API requests are token-gated; no secrets are stored in the client or repository.

**Known limitations:** The 3-second dashboard request cycle depends on a browser being open. Neon Functions are request-driven, not an always-on 3-second trading loop. No automatic real-money sports or crypto orders are sent; there is no authenticated DraftKings betting API integration, no funded Polymarket orders, no validated cross-venue settlement matching system without user-reviewed mappings, and no empirically calibrated live-execution profit model. The conservative display does not show false positive trades when unverified or stale. Unfunded accounts remain nontrading by design.

Run tests locally from `kal_kings_platform/` with:

```bash
node --test test.mjs test_server.mjs strategy.test.mjs feeds.test.mjs agents.test.mjs candidate.test.mjs
```

Neon deployment bundle requires `index.mjs`, `engine.mjs`, `strategy.mjs`, `sports.mjs`, `agents.mjs`, `feeds.mjs`, `dashboard.html` at the ZIP root. The repository also includes `schema.sql` and tests. Keep `research_engine/` untouched to avoid conflicts with its owner.
