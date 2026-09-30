export const schemaSql = `
CREATE TABLE IF NOT EXISTS stocks (
  symbol TEXT PRIMARY KEY, name TEXT NOT NULL, exchange TEXT NOT NULL DEFAULT 'NSE', segment TEXT NOT NULL DEFAULT 'FO', sector TEXT NOT NULL,
  instrument_type TEXT NOT NULL DEFAULT 'EQUITY', underlying_type TEXT NOT NULL DEFAULT 'STOCK', lot_size INTEGER NOT NULL DEFAULT 1,
  tick_size REAL NOT NULL DEFAULT 0.05, provider_symbol TEXT, active_from TEXT, active_to TEXT, is_fno INTEGER NOT NULL DEFAULT 1,
  previous_open INTEGER
);
CREATE TABLE IF NOT EXISTS trading_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trading_date TEXT NOT NULL UNIQUE,
  previous_session_date TEXT NOT NULL, session_status TEXT NOT NULL DEFAULT 'ok'
);
CREATE TABLE IF NOT EXISTS session_opens (
  symbol TEXT NOT NULL REFERENCES stocks(symbol), trading_date TEXT NOT NULL REFERENCES trading_sessions(trading_date),
  previous_open INTEGER, PRIMARY KEY(symbol, trading_date)
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL REFERENCES stocks(symbol), trade_date TEXT NOT NULL,
  timestamp TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0), quantity INTEGER NOT NULL CHECK(quantity > 0),
  side TEXT NOT NULL DEFAULT 'BUY' CHECK(side IN ('BUY', 'SELL')),
  exchange TEXT NOT NULL DEFAULT 'NSE', segment TEXT NOT NULL DEFAULT 'FO', instrument TEXT,
  source TEXT NOT NULL DEFAULT 'baseline' CHECK(source IN ('baseline', 'simulated', 'historical', 'live')),
  ingest_key TEXT,
  provider_trade_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_provider_id ON trades(symbol, trade_date, source, provider_trade_id) WHERE provider_trade_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_ingest_key ON trades(ingest_key) WHERE ingest_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(symbol, trade_date, source, timestamp, id);
CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, trading_date TEXT NOT NULL,
  provider TEXT NOT NULL, status TEXT NOT NULL, trade_count INTEGER NOT NULL DEFAULT 0,
  error TEXT, started_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_collection_runs_date ON collection_runs(trading_date, id DESC);
CREATE TABLE IF NOT EXISTS analysis_results (
  symbol TEXT NOT NULL, trading_date TEXT NOT NULL, bucket REAL NOT NULL, top_levels INTEGER NOT NULL,
  analysis_version TEXT NOT NULL, input_trade_count INTEGER NOT NULL, result_json TEXT NOT NULL,
  calculated_at TEXT NOT NULL, PRIMARY KEY(symbol, trading_date, bucket, top_levels, analysis_version)
);
`;
