# Kal Kings — order-book and Monte Carlo risk manager

## Production wiring

The Neon minute trigger runs `/cron/kalshi-solo` and never depends on DraftKings. It first reconciles previously tracked Kalshi orders, reads free cash and positions from the authenticated Kalshi API, and records a bounded fresh quote sample (including when available cash is zero). It then scans for same-market complementary YES/NO quotes, requotes the market, reads the exact exchange order book, evaluates candidate sizes, runs sequential-fill Monte Carlo, checks correlated exposure and a bankroll-linked tail-loss ceiling, and submits bounded `fill_or_kill` V2 orders only if they qualify. Exit monitoring uses fresh bid depth, stop/trailing rules and (where sufficient recorded history exists) an empirical Monte Carlo hold-versus-exit model. No model can identify future price peaks with certainty.

## Evidence standards

- The historical quote table contains exchange-observed prices, *not executions*. It is not a record of realized returns.
- The backtest steps forward from observed ask to the next observed bid and includes modeled costs. It is evidence about historical changes, not a fill simulator.
- Forecast probability calibration uses chronological train/holdout separation; no verified calibration score is claimed without settled outcome labels that predate the holdout decisions.
- The fill-rate model uses only confirmed Kalshi order receipts and reports when the sample is too small. Simulation excludes no-fills from profit/loss win rates; it retains one-sided exposure as a loss scenario.
- All market inputs must be current. The UI polls at 3 seconds, but exchange quote timestamps and a newly fetched book govern automated orders.
- Execution is not atomic across two legs. When a leg is ambiguous, the engine records the uncertainty and halts further entries instead of assuming a hedge succeeded.
- The exchange's available cash is the only reinvestment balance source. Settlements are tracked as evidence, not credited a second time.
- The bot only auto-manages positions recorded as its own, and cannot intentionally sell manual/DraftKings-hedged holdings.

## Run regression tests

From `kal_kings_platform/`:

```sh
node --test '*.test.mjs'
```

Neon tables: `kal_kings_market_observations` and `kal_kings_quant_decisions` (`quant-schema.sql`). The native Neon trigger is defined separately and must remain enabled. Trading does not occur without genuine positive quoted spreads, sufficient actual funds, compatible market rules, complete holdings and qualifying Monte Carlo outcomes.

No guaranteed returns or proven live calibration are claimed. The deployed scheduled worker is a real order-submission path when all conditions qualify, but a completed deployment is not evidence that a live order has been filled.
