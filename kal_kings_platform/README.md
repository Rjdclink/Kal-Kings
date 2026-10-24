# Kal Kings · Neon trading intelligence dashboard

Single Neon Node.js 24 Function, source in `kal_kings_platform/` (a separate integration lane; does not modify `research_engine/` or `trading_dashboard/`). A live dashboard is served at `/`, with public `/health` and `/api/public-state` routes. All other API routes remain token-gated. GitHub Actions and Railway are not used.

### Public access (deployment 5)

Opening the deployed URL now loads the dashboard without a login overlay. The public view requests only `/api/public-state`, containing read-only Kalshi, Polymarket US, DraftKings-provider feeds and crypto context, with empty private financial fields. Feed failures are isolated; unavailable providers display their reason. No matching, ranking or simulation runs in the public endpoint. Account balances, holdings, records, settings changes and all private APIs remain protected. The admin secret is retained unchanged because it also protects encrypted settings. Public access does not expose private state or grant write permissions.

Validation: nine Node tests passed; the deployed public endpoint returned HTTP 200 without authorization, with 200 Kalshi quotes, 86 Polymarket US quotes and two crypto prices. DraftKings returned no quotes because the odds-provider key was not configured. This status is displayed rather than represented as a working feed.

### Market connections

- Kalshi: public sports event quotes (3-second server cache) and signed authenticated account/holdings reads (`KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY`, `KALSHI_ENVIRONMENT=production`). These variables belong in the **Neon Function runtime**, not the repo.
- Polymarket US: public US markets (8-second server cache) and authenticated balance API readiness with `POLYMARKET_KEY_ID` and `POLYMARKET_SECRET_KEY` (Neon runtime). No Polymarket funds or orders are tracked.
- DraftKings Sportsbook: The Odds API bookmaker `draftkings` odds data. Configure `ODDS_API_KEY` in Neon, or use the protected settings API; it is AES-256-GCM encrypted in Neon database. Quotes refresh based on provider cadence / server cache of 60 seconds. The UI checks every three seconds; that does not mean upstream odds change every three seconds.
- Crypto: Coinbase Exchange BTC/USD and ETH/USD spot reference prices, TradingView independent chart links. Neither is a direct TradingView API signal.

### Administration and persistence

Set `KALKINGS_ADMIN_TOKEN` (32+ unpredictable characters) in the **Neon Function deployment environment**. API calls use it in `x-kal-kings-admin`; the public browser view does not request or store it. Authorized API clients must supply it for private routes. Do not commit this value or exchange secrets to GitHub. Neon injects `DATABASE_URL`; the Function uses Neon's HTTPS SQL API. Tables are defined in `schema.sql` and created in the existing `Kal Kings` project.

DraftKings bankroll entries, accepted tickets, settlements, encrypted odds key and explicitly reviewed settlement mappings are stored in Neon. The view is empty until a real balance or bet is entered. There are no invented prices or profitable opportunities. Comparisons require a stored review of full market settlement rules; title similarity alone is insufficient. The board shows a maximum of 10 reviewed positive conditional opportunities, not 10 invented trades.

### Monte Carlo

`engine.mjs` runs deterministic, seeded scenario simulations for potential hedge failure and event outcomes. Inputs include an *assumed* outcome probability and manual DraftKings fill probability; outputs are expected P/L, tails and loss-scenario frequency. Results are **not calibrated forecasts**, and no scenario model makes an unhedged Kalshi position riskless.

### Execution and limitations

This first operational dashboard is a **read-only live-data and manual DraftKings bookkeeping application**. It does not submit Kalshi orders or DraftKings wagers, and it is not an autonomous arbitrage bot. Live execution requires additional integration validation and explicit settlement/fill reconciliation. The existence of private API keys does not itself establish successful authentication; `/api/state` reports the actual result. GitHub Actions variables/secrets are not injected into Neon; Polymarket US keys stored there must also be securely configured in Neon to enable authenticated checks.

### Local tests

```bash
cd kal_kings_platform
node --test test.mjs test_server.mjs
```

Neon deployment expects a ZIP with `index.mjs`, `engine.mjs`, and `dashboard.html` at archive root, runtime `nodejs24`, function slug `kalkingsdashboard`.

