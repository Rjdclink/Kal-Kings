# Neon connection service

Node.js request/response readiness endpoint, compatible with Neon's `nodejs24` runtime. This is not a trading worker and does not execute orders or run the Python research engine.

Deployed 2026-10-24 to the existing Kal Kings project, main branch, function `kalshiconnection`. Neon reports deployment 1 completed. URL: https://br-weathered-rain-b5vxpp21-kalshiconnection.compute.c-7.us-east-2.aws.neon.tech/

Only `KALSHI_ENVIRONMENT=production` was supplied. Kalshi credentials could not be accessed through the connected GitHub plugin; admin access is intentionally unconfigured until securely provisioned. No authenticated account connection has been established.

Routes:

* `GET /health`: public service health and configuration-presence flags only. Never claims authentication without testing it.
* `GET /api/kalshi/check`: protected read-only exchange-status and account-authentication check. Requires `Authorization: Bearer <KALKINGS_ADMIN_TOKEN>`. No balances or keys are returned.

Runtime settings: `KALSHI_ENVIRONMENT` (`production` or `demo`), `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY` (PEM secret), and `KALKINGS_ADMIN_TOKEN` (at least 32 characters). The latter three must be supplied securely in the Neon deployment environment. GitHub repository variables/secrets are not automatically injected. Do not put keys in the URL, frontend, repository files or logs.

Package `index.mjs` at the ZIP root; no dependencies. Deploy using Neon function deployment with runtime `nodejs24`. Test with `node --test test.mjs`. Environment values are encrypted/write-only through Neon; future config-only deployments must include the complete intended environment map to avoid dropping existing settings.

Authenticated redirects are blocked, requests time out after ten seconds, unsupported signing keys fail closed, and errors omit credentials and upstream bodies. Private endpoints remain unavailable until credentials and admin access are configured. Python analysis remains independently runnable and is not falsely reported as deployed here.
