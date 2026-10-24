# Research and implementation decisions

Checked 2026-10-24. Primary sources below informed implementation; exchange documents can change.

## Arbitrage versus directional forecasts

For a buy-only basket of q units per leg and modeled settlement states s, the engine calculates minimum_s(q × sum_i payoff[s,i]) minus acquisition costs, fee bounds and slippage reserves. Positive result is conditional on exhaustive correct states and fills, not a guaranteed trade. All-or-nothing entry across legs is not assumed. Cross-market rule differences and one-sided fills can turn apparent arbitrage into directional exposure. This formula and implementation are our derivation.

The first engine supports reviewed complementary/threshold/partition-style baskets through their payout matrices; it does not infer logical coverage from market names. Short sales, dynamic hedging, portfolio allocation, capital lockup, default and funding are not modeled. It only searches whole-unit equal-leg sizes, although input depth retains fractional precision.

## Kalshi microstructure and fees

[Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses): bids on one outcome imply asks on the opposite outcome. Using bids directly as acquisition prices creates fictitious edges. The adapter complements opposite-side bids and preserves depth.

[Fixed-point representation](https://docs.kalshi.com/getting_started/fixed_point_migration): prices and quantities use decimal strings with four and two decimal places respectively. The research core uses Decimal and rejects unsupported precision. Any future order adapter must additionally honor each market's price grid; this code submits no orders.

[July 2026 fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf) describes a quadratic general fee with product multipliers and exceptions. [Fee rounding](https://docs.kalshi.com/getting_started/fee_rounding) explains per-fill trade fees, balance alignment and accumulated rebates. Rather than claim exact fills or rebates, the engine bounds fee-model cost plus a rounding allowance for every possible .01-contract fill. This deliberately pessimistic bound can reject valid opportunities. It assumes the supplied fee model is correct; upstream verification must include series/event overrides and upcoming changes. No universal hardcoded fee is asserted for live markets.

[Market settlement](https://docs.kalshi.com/getting_started/market_settlement) distinguishes final payouts, netting and potential rounding. Timing varies. Reviewed scenario matrices are required; unusual payouts must be reflected explicitly.

[WebSocket orderbooks](https://docs.kalshi.com/websockets/orderbook-updates) deliver a snapshot followed by updates and require authentication. Streaming ingestion is left to the existing integration owner; it must invalidate books after sequence gaps and resynchronize. [Rate limits](https://docs.kalshi.com/getting_started/rate_limits) are token-based. The public adapter uses conservative pacing and bounded retries, not an assumed universal account tier.

## Monte Carlo interpretation

The event simulator uses a shared outage and price shock, plus conditional per-leg fill/partial events and user-supplied outcome probabilities. Expected profit is the mean net dollars across all trials, including no fills. Independent-seed validation reduces sensitivity to one random sample, but selecting from validation results still induces selection bias. This is not an untouched final holdout or proof of edge. Confidence intervals describe simulation sampling error only.

[Bailey et al., Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) explains why searching configurations can exaggerate apparent performance. Deployment research needs untouched chronological evaluation, realistic costs and disclosure of the full search. [NIST, Consistency in Monte Carlo Uncertainty Analyses](https://www.nist.gov/publications/consistency-monte-carlo-uncertainty-analyses) supports reproducible, consistent uncertainty propagation. Model calibration remains essential.

## Crypto and free sources

[Coinbase Exchange](https://docs.cdp.coinbase.com/exchange/introduction/welcome) separates public market data from authenticated trading. This implementation uses Exchange candles, not authenticated trading endpoints.

[Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data) includes a current unfinished candle; all feeds are filtered to completed hours. [Bitstamp public API](https://www.bitstamp.net/api/) supplies the third venue. Gaps, stale endpoints, errors and too-short synchronized histories suppress forecasts; no synthetic fallback is shown.

[TradingView hosted widgets](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/) provide an embeddable chart. This is separate from licensed charting libraries and from data APIs. Attribution is retained. The engine neither scrapes TradingView signals nor treats chart access as permission to extract data.

Crypto exchange agreement is descriptive, not independent votes about the future. We use a median price series and resample six-hour return blocks to retain some short-range dependence. Historical drift, limited history and regime changes can dominate estimated profits. Fees/slippage are explicit illustrative inputs, not account-specific estimates. Live calibration, larger history and walk-forward tests remain unimplemented.

## Exact price and depth observations

[Coinbase product book](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-book), [Kraken L2 book](https://docs.kraken.com/api-reference/market-data/get-order-book) and the Bitstamp public API expose machine-readable levels. The depth module uses these endpoints instead of estimating prices from image pixels. It calculates a hypothetical ask-side sweep, preserving decimal prices and quantities. These snapshots do not guarantee liquidity remains available. Account permissions, exchange status, lot sizes, latency, fees and order acceptance require separate validation.

Observed entry cost can be propagated into a conditional forecast without claiming that it predicts future liquidity. Each venue variant uses VWAP relative to mid as its entry-slippage input, while future exit slippage remains an assumption. No cross-exchange arbitrage trade or automatic execution is inferred from these snapshots.
