CREATE TABLE IF NOT EXISTS kal_kings_bankroll (
  venue TEXT PRIMARY KEY,
  amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO kal_kings_bankroll (venue, amount_cents) VALUES ('draftkings',0) ON CONFLICT (venue) DO NOTHING;
CREATE TABLE IF NOT EXISTS kal_kings_wagers (
  id UUID PRIMARY KEY,
  venue TEXT NOT NULL DEFAULT 'draftkings',
  event_name TEXT NOT NULL,
  selection TEXT NOT NULL,
  odds_american INTEGER NOT NULL,
  stake_cents BIGINT NOT NULL CHECK (stake_cents > 0),
  payout_cents BIGINT NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS kal_kings_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kal_kings_pairs (
  id UUID PRIMARY KEY,
  kalshi_ticker TEXT NOT NULL,
  dk_event_id TEXT NOT NULL,
  dk_selection TEXT NOT NULL,
  kalshi_side TEXT NOT NULL CHECK (kalshi_side IN ('yes','no')),
  reviewed_rule_digest TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
