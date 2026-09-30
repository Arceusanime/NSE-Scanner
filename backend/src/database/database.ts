import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MarketDataProvider, Stock, Trade } from '../types.js';
import { schemaSql } from './schema.js';
import { previousSession } from '../services/calendar.js';
import { DEFAULT_DATABASE_PATH } from '../config.js';
import { MockMarketDataProvider } from '../providers/MockMarketDataProvider.js';

export type SqliteDatabase = Database.Database;
const toPaise = (value: number | null | undefined): number | null => {
  if (value == null) return null;
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) > 1e-8 ? Math.trunc(scaled + Number.EPSILON) : Math.round(scaled);
};
const columns = (db: SqliteDatabase, table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);

export function createDatabase(filename = DEFAULT_DATABASE_PATH): SqliteDatabase {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  // A one-time migration preserves the original scaffold tables as an archive. New sessions use
  // integer paise and per-session opens; the archive is never deleted or mistaken for exact ticks.
  if (columns(db, 'trading_sessions').includes('symbol')) {
    db.transaction(() => {
      db.exec('ALTER TABLE trading_sessions RENAME TO legacy_trading_sessions');
      db.exec('ALTER TABLE trades RENAME TO legacy_trades');
      if (columns(db, 'volume_at_price').length) db.exec('ALTER TABLE volume_at_price RENAME TO legacy_volume_at_price');
      db.exec('ALTER TABLE stocks RENAME TO legacy_stocks');
      db.exec(schemaSql);
      const legacy = db.prepare('SELECT * FROM legacy_stocks').all() as Record<string, unknown>[];
      upsertStocks(db, legacy.map((row) => ({
        symbol: String(row.symbol), name: String(row.name), exchange: 'NSE', sector: String(row.sector),
        instrumentType: row.instrument_type === 'FUTURES' ? 'FUTURES' : 'EQUITY', lotSize: Number(row.lot_size ?? 1),
        isFno: Boolean(row.is_fno ?? 1), previousOpen: row.previous_open == null ? null : Number(row.previous_open)
      })));
    })();
  } else {
    // Migrate earlier integer-paise prototypes in place. SQLite cannot add most constraints
    // safely, so new columns are additive and the normalizer remains the validation boundary.
    if (columns(db, 'trades').length && !columns(db, 'trades').includes('source')) db.exec("ALTER TABLE trades ADD COLUMN source TEXT NOT NULL DEFAULT 'baseline'");
    if (columns(db, 'trades').length && !columns(db, 'trades').includes('ingest_key')) db.exec('ALTER TABLE trades ADD COLUMN ingest_key TEXT');
    if (columns(db, 'trades').length && !columns(db, 'trades').includes('provider_trade_id')) db.exec('ALTER TABLE trades ADD COLUMN provider_trade_id TEXT');
    db.exec(schemaSql);
  }
  const addColumn = (table: string, name: string, definition: string) => {
    if (!columns(db, table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  for (const [name, definition] of [
    ['segment', "TEXT NOT NULL DEFAULT 'FO'"], ['underlying_type', "TEXT NOT NULL DEFAULT 'STOCK'"], ['tick_size', 'REAL NOT NULL DEFAULT 0.05'],
    ['provider_symbol', 'TEXT'], ['active_from', 'TEXT'], ['active_to', 'TEXT'],
  ] as const) addColumn('stocks', name, definition);
  for (const [name, definition] of [['exchange', "TEXT NOT NULL DEFAULT 'NSE'"], ['segment', "TEXT NOT NULL DEFAULT 'FO'"], ['instrument', 'TEXT']] as const) addColumn('trades', name, definition);
  db.pragma('foreign_keys = ON');
  return db;
}

export function seedDatabase(db: SqliteDatabase, provider: MarketDataProvider): void {
  const stocks = provider.getStocks();
  if (stocks instanceof Promise) throw new Error('Async provider requires seedDatabaseAsync');
  upsertStocks(db, stocks);
  // Version 0 cached the mock generator's paise anchor as a rupee previous open.
  // Repair only this metadata; baseline and simulated observations remain intact.
  if (provider instanceof MockMarketDataProvider && Number(db.pragma('user_version', { simple: true })) < 1) {
    db.transaction(() => {
      const sessions = db.prepare('SELECT symbol, trading_date FROM session_opens').all() as Array<{ symbol: string; trading_date: string }>;
      const update = db.prepare('UPDATE session_opens SET previous_open = ? WHERE symbol = ? AND trading_date = ?');
      for (const session of sessions) update.run(toPaise(provider.getPreviousOpen(session.symbol, session.trading_date)), session.symbol, session.trading_date);
      db.pragma('user_version = 1');
    })();
  }
}

export async function seedDatabaseAsync(db: SqliteDatabase, provider: MarketDataProvider, date: string): Promise<void> {
  const stocks = await (provider.getInstrumentUniverse ? provider.getInstrumentUniverse() : provider.getStocks());
  upsertStocks(db, stocks);
  for (const stock of stocks) persistBaseline(db, stock.symbol, date, await (provider.getHistoricalTrades ? provider.getHistoricalTrades(stock.symbol, date) : provider.getTrades(stock.symbol, date)), await provider.getPreviousOpen(stock.symbol, date));
}

type TradeSource = 'baseline' | 'simulated' | 'historical' | 'live';
function ingestKey(trade: Trade, source: TradeSource): string {
  return [source, trade.symbol.toUpperCase(), trade.tradeDate, trade.providerTradeId ?? trade.id ?? '', trade.timestamp, toPaise(trade.price), Math.round(trade.quantity), trade.side].join('|');
}
function validateTrade(trade: Trade): void {
  if (!trade.symbol || !trade.tradeDate || !trade.timestamp || !Number.isFinite(trade.price) || trade.price <= 0 || !Number.isSafeInteger(Math.round(trade.quantity)) || trade.quantity <= 0 || !['BUY', 'SELL'].includes(trade.side)) {
    throw new Error('Malformed market trade rejected during normalization');
  }
}
export function persistTrades(db: SqliteDatabase, trades: Trade[], source: TradeSource = 'simulated'): void {
  const insert = db.prepare('INSERT OR IGNORE INTO trades(symbol, trade_date, timestamp, price, quantity, side, exchange, segment, instrument, source, ingest_key, provider_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => { for (const trade of trades) { validateTrade(trade); insert.run(trade.symbol.toUpperCase(), trade.tradeDate, trade.timestamp, toPaise(trade.price), Math.round(trade.quantity), trade.exchange ?? 'NSE', trade.segment ?? 'FO', trade.instrument ?? trade.symbol.toUpperCase(), source, ingestKey(trade, source), trade.providerTradeId ?? trade.id ?? null); } })();
}

export function upsertStocks(db: SqliteDatabase, stocks: Stock[]): void {
  const insert = db.prepare(`INSERT INTO stocks(symbol, name, exchange, segment, sector, instrument_type, underlying_type, lot_size, tick_size, provider_symbol, active_from, active_to, is_fno, previous_open)
    VALUES (@symbol, @name, @exchange, @segment, @sector, @instrumentType, @underlyingType, @lotSize, @tickSize, @providerSymbol, @activeFrom, @activeTo, @isFno, @previousOpen)
    ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, exchange=excluded.exchange, segment=excluded.segment, sector=excluded.sector,
    instrument_type=excluded.instrument_type, underlying_type=excluded.underlying_type, lot_size=excluded.lot_size, tick_size=excluded.tick_size,
    provider_symbol=excluded.provider_symbol, active_from=excluded.active_from, active_to=excluded.active_to, is_fno=excluded.is_fno`);
  db.transaction(() => {
    for (const stock of stocks) insert.run({
      ...stock, segment: stock.segment ?? 'FO', underlyingType: stock.underlyingType ?? (stock.instrumentType === 'INDEX' ? 'INDEX' : 'STOCK'),
      tickSize: stock.tickSize ?? 0.05, providerSymbol: stock.providerSymbol ?? stock.symbol,
      activeFrom: stock.activeFrom ?? null, activeTo: stock.activeTo ?? null,
      previousOpen: toPaise(stock.previousOpen), isFno: Number(stock.isFno)
    });
  })();
}

/** The session_opens row is a completion marker, including for empty feeds/missing opens.
 * This transaction makes restarts and simultaneous requests idempotent without deleting data. */
export function persistBaseline(db: SqliteDatabase, symbol: string, date: string, trades: Trade[], previousOpen: number | null): void {
  db.transaction(() => {
    if (hasBaseline(db, symbol, date)) return;
    db.prepare(`INSERT OR IGNORE INTO trading_sessions(trading_date, previous_session_date, session_status) VALUES (?, ?, 'ok')`).run(date, previousSession(date));
    const insert = db.prepare(`INSERT OR IGNORE INTO trades(symbol, trade_date, timestamp, price, quantity, side, exchange, segment, instrument, source, ingest_key, provider_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'baseline', ?, ?)`);
    for (const rawTrade of trades) {
      const trade = { ...rawTrade, symbol, tradeDate: date, side: rawTrade.side ?? 'BUY' as const };
      validateTrade(trade);
      insert.run(symbol.toUpperCase(), date, trade.timestamp, toPaise(trade.price), Math.round(trade.quantity), trade.side, trade.exchange ?? 'NSE', trade.segment ?? 'FO', trade.instrument ?? symbol.toUpperCase(), ingestKey(trade, 'baseline'), trade.providerTradeId ?? trade.id ?? null);
    }
    db.prepare('INSERT INTO session_opens(symbol, trading_date, previous_open) VALUES (?, ?, ?)').run(symbol, date, toPaise(previousOpen));
  })();
}
export function hasBaseline(db: SqliteDatabase, symbol: string, date: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM session_opens WHERE symbol = ? AND trading_date = ?').get(symbol, date));
}
export interface CollectionStatusRow {
  symbol: string | null;
  tradingDate: string;
  provider: string;
  status: string;
  tradeCount: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}
export function recordCollectionRun(db: SqliteDatabase, run: Omit<CollectionStatusRow, 'completedAt'> & { completedAt?: string | null }): void {
  db.prepare(`INSERT INTO collection_runs(symbol, trading_date, provider, status, trade_count, error, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(run.symbol, run.tradingDate, run.provider, run.status, run.tradeCount, run.error, run.startedAt, run.completedAt ?? null);
}
export function latestCollectionRuns(db: SqliteDatabase, date?: string): CollectionStatusRow[] {
  const rows = db.prepare(`SELECT symbol, trading_date, provider, status, trade_count, error, started_at, completed_at
    FROM collection_runs ${date ? 'WHERE trading_date = ?' : ''} ORDER BY id DESC`).all(...(date ? [date] : [])) as Record<string, unknown>[];
  return rows.map((row) => ({ symbol: row.symbol == null ? null : String(row.symbol), tradingDate: String(row.trading_date), provider: String(row.provider), status: String(row.status), tradeCount: Number(row.trade_count), error: row.error == null ? null : String(row.error), startedAt: String(row.started_at), completedAt: row.completed_at == null ? null : String(row.completed_at) }));
}

export function rowToStock(row: Record<string, unknown>): Stock {
  return {
    symbol: String(row.symbol), name: String(row.name), exchange: 'NSE', segment: row.segment === 'CM' ? 'CM' : 'FO', sector: String(row.sector),
    instrumentType: row.instrument_type === 'FUTURES' ? 'FUTURES' : row.instrument_type === 'INDEX' ? 'INDEX' : 'EQUITY',
    underlyingType: row.underlying_type === 'INDEX' ? 'INDEX' : 'STOCK', lotSize: Number(row.lot_size ?? 1), tickSize: Number(row.tick_size ?? 0.05),
    providerSymbol: row.provider_symbol == null ? String(row.symbol) : String(row.provider_symbol), activeFrom: row.active_from == null ? null : String(row.active_from), activeTo: row.active_to == null ? null : String(row.active_to),
    isFno: Boolean(row.is_fno ?? 1), previousOpen: row.previous_open == null ? null : Number(row.previous_open) / 100
  };
}
export function rowToTrade(row: Record<string, unknown>): Trade {
  return {
    id: Number(row.id), providerTradeId: row.provider_trade_id == null ? undefined : String(row.provider_trade_id), symbol: String(row.symbol), exchange: 'NSE',
    segment: row.segment === 'CM' ? 'CM' : 'FO', instrument: row.instrument == null ? String(row.symbol) : String(row.instrument), tradeDate: String(row.trade_date),
    timestamp: String(row.timestamp), price: Number(row.price) / 100, quantity: Number(row.quantity), side: row.side as 'BUY' | 'SELL', source: row.source as Trade['source']
  };
}
