# Exchange connectivity

`check.mjs` provides read-only authenticated balance checks for Kalshi and Polymarket US. This is the US Ed25519 API, not the global Polymarket CLOB API.

## Polymarket US deployment

Neon project `green-heart-81271475`, branch `br-weathered-rain-b5vxpp21`, function `polymarketconnection`, deployment 1 (Node.js 24).

URL: https://br-weathered-rain-b5vxpp21-polymarketconnection.compute.c-7.us-east-2.aws.neon.tech/

On 2026-10-24 the deployed, protected `GET /api/polymarket/check` returned HTTP 200 with `authentication: VERIFIED` and `balance_readable: true`. This was a live authenticated request, not a fixture. No balances or credentials are included in the response. No orders were submitted and automation remains disabled.

Runtime environment contains `POLYMARKET_KEY_ID`, `POLYMARKET_SECRET_KEY`, and `KALKINGS_ADMIN_TOKEN`. The existing GitHub variable named `POLYMARKEY_SECRET_KEY` was mapped to the correctly spelled runtime name. Credential values are not committed. The Kalshi function remains separate and unchanged.

`GET /health` reports configuration presence only; it does not verify authentication. `GET /api/polymarket/check` requires `Authorization: Bearer <KALKINGS_ADMIN_TOKEN>`. All non-GET methods are rejected. The service can only call the fixed account balance endpoint, with redirects disabled and a ten-second timeout. It cannot place, modify, or cancel orders.

Package `runtime.mjs` as `index.mjs` and `check.mjs` as `check.mjs` at the ZIP root. Redeploy code with environment omitted to retain the encrypted runtime environment. For subsequent callers, provision a known admin token through the secure runtime configuration; the initial verification token is not stored in source or documentation.

Validation: `node --test integrations/exchange-connectivity/test.mjs integrations/exchange-connectivity/runtime.test.mjs research_engine/neon_runtime/test.mjs` — 19 tests passed, including signatures, authorization, route restrictions, read-only requests, and error redaction.

Official API reference: https://docs.polymarket.us/api-reference/account/get-account-balances
