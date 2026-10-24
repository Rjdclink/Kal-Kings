-- Autonomous portfolio monitoring: only Kal Kings-owned orphan positions.
-- Settlement notices never directly add funds to account balances.
CREATE TABLE IF NOT EXISTS kal_kings_position_watch (
  ticker TEXT PRIMARY KEY,
  position_side TEXT NOT NULL CHECK(position_side IN ('yes','no')),
  entry_price NUMERIC(10,4) NOT NULL,
  high_bid NUMERIC(10,4) NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('WATCHING','SUBMITTING','UNCERTAIN','CLOSED')),
  exit_client_order_id UUID,
  exit_order_id TEXT,
  exit_fill_count NUMERIC(14,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kal_kings_bot_settlements (
  ticker TEXT PRIMARY KEY,
  settled_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
