-- Idempotent Kalshi execution audit, no secret material or financial account numbers.
ALTER TABLE kal_kings_wagers ADD COLUMN IF NOT EXISTS pair_id UUID;
CREATE TABLE IF NOT EXISTS kal_kings_auto_orders (
  client_order_id UUID PRIMARY KEY,
  wager_id UUID NOT NULL UNIQUE REFERENCES kal_kings_wagers(id),
  kalshi_ticker TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTING','FILLED','NOT_FILLED','PARTIALLY_FILLED','REJECTED','UNKNOWN')),
  count NUMERIC(12,2) NOT NULL CHECK (count>0),
  limit_price NUMERIC(10,4) NOT NULL CHECK (limit_price>0 AND limit_price<1),
  order_id TEXT,
  filled_count NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
