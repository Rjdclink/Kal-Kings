# Compact crypto research dashboard

The dashboard displays three fields per expandable card: trade name, hypothetical capital, and estimated net profit. Expanded cards contain amount editing, scenario, qualification explanation, modeled downside, observation time, and liquidity limitations. Model assumptions, sources, and the historical input chart are nested. TradingView remains optional and separate from model inputs.

Only fresh positive modeled estimates appear in the main list. Negative or unavailable observations are separate. At most ten results are shown; the current scanner supports BTC and ETH only, so at most two qualify. This is not a ten-opportunity scanner or an arbitrage guarantee.

Changing an amount calls `/api/crypto?capital=...`, recalculates Monte Carlo at that capital, and checks displayed book depth at that amount. The headline uses illustrative costs; venue-specific depth forecasts remain in the API. Capital is bounded from $1 to $1,000,000. Funds are not verified against any account. Failed refreshes hide previous profit cards; observations older than 90 seconds expire. Completed hourly price history is distinct from live quotes. Current holdings, account allocation cards, sportsbook recommendations, four-source synchronization, and order execution are not implemented in this dashboard.

Run locally from `research_engine` with `python -m kalresearch.dashboard`, then open http://127.0.0.1:8765. Publishing the repository does not deploy a hosted dashboard.

Validation: 50 Python tests passed, including HTTP capital validation and cache isolation by amount. Two Node DOM-harness tests passed, covering card filtering, three-field summaries, edited amount forwarding, and expiry/network failure handling. JavaScript syntax passed. Visual rendering and external TradingView widget loading have not been browser-verified for this revision.
