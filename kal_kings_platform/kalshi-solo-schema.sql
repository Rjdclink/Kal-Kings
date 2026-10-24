-- Kal Kings standalone Kalshi engine; separate from DraftKings wagering records.
CREATE TABLE IF NOT EXISTS kal_kings_solo_runs (
 invocation_id TEXT PRIMARY KEY,
 scheduled_at TIMESTAMPTZ NOT NULL,
 result TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS kal_kings_solo_orders (
 ticker TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('SUBMITTING','YES_FILLED','HEDGED','UNHEDGED','UNCERTAIN','NOT_FILLED','PARTIALLY_FILLED')),
 yes_client_order_id UUID NOT NULL,
 no_client_order_id UUID NOT NULL,
 contracts NUMERIC(14,2) NOT NULL CHECK (contracts>0),
 yes_price NUMERIC(10,4) NOT NULL,
 no_price NUMERIC(10,4) NOT NULL,
 net_profit_dollars NUMERIC(14,4) NOT NULL,
 capital_reserved_dollars NUMERIC(14,4) NOT NULL,
 yes_filled NUMERIC(14,2) NOT NULL DEFAULT 0,
 no_filled NUMERIC(14,2) NOT NULL DEFAULT 0,
 yes_order_id TEXT,
 no_order_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
