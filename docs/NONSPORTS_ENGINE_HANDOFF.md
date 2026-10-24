# Non-sports research engine coordination

This lane owns `research_engine/` only. Existing integration work must remain untouched.

Scope: non-sports economic and financial event-contract analysis, public read-only data, and paper simulation. No sportsbook adapters or live order submission.

The repository was empty at inspection on 2026-10-24. No reachable Agent Parley participant or messaging endpoint was available; this is an asynchronous handoff, not an acknowledged conversation.

Adapters will provide immutable snapshots with exact decimal prices, verified non-sports category, explicit fee schedule and provenance. Settlement equivalence must be reviewed from full rules; matching titles is insufficient. See `research_engine/README.md` and `research_engine/RESEARCH.md` when the engine commit lands.

No credentials belong in source. No GitHub Actions or hosting changes are part of this lane.
