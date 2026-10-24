-- Kal Kings: exactly one explicitly requested, externally reconciled micro order.
CREATE TABLE IF NOT EXISTS kal_kings_live_tests (
  test_id TEXT PRIMARY KEY,
  client_order_id UUID UNIQUE NOT NULL,
  market_ticker TEXT NOT NULL,
  limit_price NUMERIC(10,4) NOT NULL CHECK (limit_price>0 AND limit_price<=0.0200),
  estimated_max_debit NUMERIC(10,4) NOT NULL CHECK (estimated_max_debit>0 AND estimated_max_debit<=0.0300),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTING','FILLED','NOT_FILLED','UNCERTAIN')),
  exchange_order_id TEXT,
  filled_contracts NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
