import type Database from 'better-sqlite3';
import { hasBaseline, persistBaseline, persistTrades, recordCollectionRun, latestCollectionRuns, rowToStock, rowToTrade, type SqliteDatabase } from '../database/database.js';
import { MockMarketDataProvider } from '../providers/MockMarketDataProvider.js';
import { SAMPLE_HOLIDAYS, defaultSessionDate, previousSession, resolveSession } from './calendar.js';
import { ANALYSIS_VERSION, type MarketDataProvider, type ScannerEnvelope, type ScannerQuery, type ScannerRow, type SessionStatus, type Stock, type Trade, type VolumeProfile, type Overview } from '../types.js';
import { calculateVolumeProfile, normalizeBucket, normalizeTopLevels } from './volumeProfile.js';

export const HOLIDAYS = SAMPLE_HOLIDAYS;
function round(value: number | null): number | null { return value === null ? null : Number(value.toFixed(2)); }

export interface ResolvedDate { requestedDate: string; date: string; previousSessionDate: string; holiday: boolean; }

export class MarketService {
  private readonly provider: MarketDataProvider;
  private readonly defaultDateValue?: string;
  private readonly ensuredSymbols = new Set<string>();
  readonly dataMode: NonNullable<MarketDataProvider['dataMode']>;
  readonly calculationMode: NonNullable<MarketDataProvider['calculationMode']>;

  constructor(private readonly db: SqliteDatabase, provider?: MarketDataProvider, defaultDate?: string) {
    this.dataMode = provider?.dataMode ?? 'mock';
    this.calculationMode = provider?.calculationMode ?? 'exact';
    this.provider = provider ?? new MockMarketDataProvider();
    this.defaultDateValue = defaultDate;
  }

  static previousTradingDay(now = new Date()): string { return defaultSessionDate(now); }
  defaultDate(): string { return this.defaultDateValue ?? defaultSessionDate(); }

  resolveDate(requested?: string): ResolvedDate {
    const requestedDate = requested ?? this.defaultDate();
    return resolveSession(requestedDate);
  }


  listStocks(): Stock[] {
    return (this.db.prepare('SELECT symbol, name, exchange, segment, sector, instrument_type, underlying_type, lot_size, tick_size, provider_symbol, active_from, active_to, is_fno, previous_open FROM stocks ORDER BY symbol').all() as Record<string, unknown>[]).map(rowToStock);
  }
  getStock(symbol: string): Stock | null {
    const row = this.db.prepare('SELECT symbol, name, exchange, segment, sector, instrument_type, underlying_type, lot_size, tick_size, provider_symbol, active_from, active_to, is_fno, previous_open FROM stocks WHERE symbol = ?').get(symbol.toUpperCase()) as Record<string, unknown> | undefined;
    return row ? rowToStock(row) : null;
  }

  /** Ensure one date is materialized without deleting prior sessions or simulated trades. */
  ensureSession(date: string, symbol?: string): void {
    const symbols = symbol ? [symbol.toUpperCase()] : this.listStocks().map((stock) => stock.symbol);
    const getTrades = this.provider.getHistoricalTrades ?? this.provider.getTrades;
    if (HOLIDAYS.has(date)) {
      this.db.prepare(`INSERT OR IGNORE INTO trading_sessions(trading_date, previous_session_date, session_status) VALUES (?, ?, 'No trading session')`).run(date, previousSession(date));
      return;
    }
    for (const currentSymbol of symbols) {
      const marker = `${date}:${currentSymbol}`;
      if (this.ensuredSymbols.has(marker) || hasBaseline(this.db, currentSymbol, date)) { this.ensuredSymbols.add(marker); continue; }
      const startedAt = new Date().toISOString();
      try {
        const trades = getTrades.call(this.provider, currentSymbol, date);
        if (trades instanceof Promise) throw new Error('An async market provider must be initialized through its repository adapter before serving HTTP');
        const open = this.provider.getPreviousOpen(currentSymbol, date);
        if (open instanceof Promise) throw new Error('An async market provider must be initialized through its repository adapter before serving HTTP');
        persistBaseline(this.db, currentSymbol, date, trades, open);
        recordCollectionRun(this.db, { symbol: currentSymbol, tradingDate: date, provider: this.provider.name ?? this.dataMode, status: 'complete', tradeCount: trades.length, error: null, startedAt, completedAt: new Date().toISOString() });
      } catch (error) {
        recordCollectionRun(this.db, { symbol: currentSymbol, tradingDate: date, provider: this.provider.name ?? this.dataMode, status: 'failed', tradeCount: 0, error: error instanceof Error ? error.message : String(error), startedAt, completedAt: new Date().toISOString() });
        throw error;
      }
      this.ensuredSymbols.add(marker);
    }
    this.db.prepare(`UPDATE trading_sessions SET session_status = CASE WHEN EXISTS(SELECT 1 FROM trades WHERE trade_date = ?) THEN 'ok' ELSE 'No trade data available' END WHERE trading_date = ?`).run(date, date);
  }

  private sessionStatus(date: string): SessionStatus {
    const row = this.db.prepare('SELECT session_status FROM trading_sessions WHERE trading_date = ?').get(date) as { session_status?: string } | undefined;
    return (row?.session_status as SessionStatus | undefined) ?? 'No trading session';
  }
  private open(symbol: string, date: string): number | null {
    const row = this.db.prepare('SELECT previous_open FROM session_opens WHERE symbol = ? AND trading_date = ?').get(symbol, date) as { previous_open?: number | null } | undefined;
    return row?.previous_open === null || row?.previous_open === undefined ? null : Number(row.previous_open) / 100;
  }
  private allTrades(symbol: string, date: string): Trade[] {
    return (this.db.prepare(`SELECT id, symbol, trade_date, timestamp, price, quantity, side, source FROM trades WHERE symbol = ? AND trade_date = ? ORDER BY timestamp ASC, id ASC`).all(symbol.toUpperCase(), date) as Record<string, unknown>[]).map(rowToTrade);
  }
  getTrades(symbol: string, date?: string, limit?: number, offset = 0): Trade[] {
    const resolved = this.resolveDate(date);
    this.ensureSession(resolved.date, symbol);
    const safeLimit = limit === undefined ? -1 : Math.max(1, Math.floor(limit));
    return (this.db.prepare(`SELECT id, symbol, trade_date, timestamp, price, quantity, side, source FROM trades WHERE symbol = ? AND trade_date = ? ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?`).all(symbol.toUpperCase(), resolved.date, safeLimit, Math.max(0, Math.floor(offset))) as Record<string, unknown>[]).map(rowToTrade);
  }
  getLatestTrade(symbol: string, date?: string): Trade | null {
    const resolved = this.resolveDate(date);
    this.ensureSession(resolved.date, symbol);
    const row = this.db.prepare('SELECT id, symbol, trade_date, timestamp, price, quantity, side, source FROM trades WHERE symbol = ? AND trade_date = ? ORDER BY timestamp DESC, id DESC LIMIT 1').get(symbol.toUpperCase(), resolved.date) as Record<string, unknown> | undefined;
    return row ? rowToTrade(row) : null;
  }
  getHistoricalTrades(symbol: string, date?: string): Trade[] { return this.getTrades(symbol, date); }
  getIntradayTrades(symbol: string, date?: string): Trade[] { return this.getTrades(symbol, date); }

  private profileResolved(symbol: string, resolved: ResolvedDate, bucket?: number, topLevels?: number): VolumeProfile | null {
    const stock = this.getStock(symbol);
    if (!stock) return null;
    this.ensureSession(resolved.date, stock.symbol);
    const previousOpen = resolved.holiday ? null : this.open(stock.symbol, resolved.date);
    const trades = this.allTrades(stock.symbol, resolved.date);
    const profile = calculateVolumeProfile(stock.symbol, resolved.date, trades, { bucket, topLevels, previousOpen, dataMode: this.dataMode, calculationMode: this.calculationMode, source: this.provider.name ?? this.dataMode });
    profile.name = stock.name; profile.sector = stock.sector; profile.exchange = stock.exchange; profile.instrumentType = stock.instrumentType; profile.lotSize = stock.lotSize; profile.isFno = stock.isFno;
    profile.previousSessionDate = resolved.previousSessionDate; profile.requestedDate = resolved.requestedDate;
    if (resolved.holiday) profile.status = 'No trading session';
    else if (!profile.tradeCount) profile.status = 'No trade data available';
    else if (previousOpen === null) profile.status = 'Previous open unavailable';
    profile.analysisVersion = ANALYSIS_VERSION;
    profile.dataMode = this.dataMode;
    profile.calculationMode = this.calculationMode;
    profile.dataQuality = { ...profile.dataQuality, ...(resolved.holiday ? { status: 'unavailable' as const, label: 'No trading session', reason: 'no_trading_session' } : {}) };
    profile.quality = profile.dataQuality;
    profile.missingReason = profile.dataQuality.reason;
    this.persistAnalysis(profile);
    return profile;
  }

  profile(symbol: string, date?: string, bucket?: number, topLevels?: number): VolumeProfile | null {
    return this.profileResolved(symbol, this.resolveDate(date), bucket, topLevels);
  }

  private scannerUniverse(resolved: ResolvedDate, bucket: number, topLevels: number, liquidityThreshold = 100000): ScannerRow[] {
    return this.listStocks().map((stock) => {
      const profile = this.profileResolved(stock.symbol, resolved, bucket, topLevels)!;
      const status = profile.status === 'ok' && profile.totalVolume < liquidityThreshold ? 'Low liquidity' : profile.status;
      const { levels: _levels, priceSeries: _priceSeries, ...summary } = profile;
      return { ...summary, status };
    });
  }

  private overview(rows: ScannerRow[]): Overview {
    const gaps = rows.map((row) => row.signedGap).filter((gap): gap is number => gap !== null);
    const withLevels = rows.filter((row) => row.aboveLevels.length > 0 || row.belowLevels.length > 0).length;
    return { scanned: rows.length, above: gaps.filter((gap) => gap > 0).length, below: gaps.filter((gap) => gap < 0).length, unchanged: gaps.filter((gap) => gap === 0).length,
      largestGap: gaps.length ? Math.max(...gaps.map((gap) => Math.abs(gap))) : null, smallestGap: gaps.length ? Math.min(...gaps.map((gap) => Math.abs(gap))) : null,
      averageGap: gaps.length ? round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) : null, withLevels, missing: rows.length - withLevels };
  }

  scanner(params: ScannerQuery = {}): ScannerEnvelope {
    const resolved = this.resolveDate(params.date);
    const bucket = normalizeBucket(params.bucket); const topLevels = normalizeTopLevels(params.topLevels);
    const liquidityThreshold = params.liquidityThreshold ?? 100000;
    const universe = this.scannerUniverse(resolved, bucket, topLevels, liquidityThreshold);
    const overview = this.overview(universe);
    const withGaps = universe.filter((row) => row.pointGap !== null);
    const largestGaps = [...withGaps].sort((a, b) => b.pointGap! - a.pointGap! || a.symbol.localeCompare(b.symbol)).slice(0, 5);
    const highestVolume = universe.filter((row) => row.hvtp !== null).sort((a, b) => b.hvtpVolume - a.hvtpVolume || (a.pointGap ?? Infinity) - (b.pointGap ?? Infinity) || a.symbol.localeCompare(b.symbol)).slice(0, 5);
    const closestToOpen = [...withGaps].sort((a, b) => a.pointGap! - b.pointGap! || a.symbol.localeCompare(b.symbol)).slice(0, 5);
    const query = params.query?.trim().toLowerCase();
    const sector = params.sector && params.sector !== 'All sectors' && params.sector !== 'all' ? params.sector : undefined;
    const minVolume = params.minVolume ?? 0;
    let rows = universe.filter((row) => row.hvtpVolume >= minVolume && row.totalVolume >= liquidityThreshold && (!sector || row.sector === sector) && (!query || row.symbol.toLowerCase().includes(query) || (row.name ?? '').toLowerCase().includes(query)));
    const direction = params.direction === 'above' || params.direction === 'below' ? params.direction : 'all';
    if (direction !== 'all') rows = rows.filter((row) => direction === 'above' ? (row.signedGap ?? 0) > 0 : (row.signedGap ?? 0) < 0);
    const sort = params.sort ?? 'pointGap'; const order = params.order === 'asc' ? 1 : -1;
    const value = (row: ScannerRow): number | string | null => {
      if (sort === 'symbol') return row.symbol;
      const raw = row[sort as keyof ScannerRow]; return typeof raw === 'number' ? raw : null;
    };
    rows.sort((a, b) => {
      const av = value(a); const bv = value(b);
      // Missing metrics do not outrank valid observations in either direction.
      if (av === null || bv === null) return av === bv ? a.symbol.localeCompare(b.symbol) : av === null ? 1 : -1;
      const comparison = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv);
      return comparison * order || a.symbol.localeCompare(b.symbol);
    });
    const limit = params.limit === 'all' || params.limit === undefined ? rows.length : Math.max(1, Math.floor(params.limit));
    const sessionStatus = resolved.holiday ? 'No trading session' : universe.some((row) => row.tradeCount > 0) ? 'ok' : 'No trade data available';
    return { rows: rows.slice(0, limit), count: Math.min(rows.length, limit), date: resolved.date, requestedDate: resolved.requestedDate,
      previousSessionDate: resolved.previousSessionDate, defaultDate: this.defaultDate(), sessionStatus, dataMode: this.dataMode, calculationMode: this.calculationMode, analysisVersion: ANALYSIS_VERSION, dataQuality: universe.every((row) => row.dataQuality?.status === 'complete') ? { status: 'complete', label: 'Complete', tradeCount: universe.reduce((sum, row) => sum + row.tradeCount, 0), hasPreviousOpen: true, source: this.provider.name ?? this.dataMode } : undefined, overview, rankings: { largestGaps, highestVolume, closestToOpen } };
  }

  private persistAnalysis(profile: VolumeProfile): void {
    this.db.prepare(`INSERT INTO analysis_results(symbol, trading_date, bucket, top_levels, analysis_version, input_trade_count, result_json, calculated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(symbol, trading_date, bucket, top_levels, analysis_version)
      DO UPDATE SET input_trade_count=excluded.input_trade_count, result_json=excluded.result_json, calculated_at=excluded.calculated_at`).run(
      profile.symbol, profile.date, profile.bucket, profile.topLevelsRequested ?? normalizeTopLevels(), profile.analysisVersion,
      profile.tradeCount, JSON.stringify(profile), new Date().toISOString());
  }

  collectionStatus(date?: string): { provider: string; dataMode: string; calculationMode: string; sessions: ReturnType<typeof latestCollectionRuns>; expectedInstruments: number; receivedInstruments: number; missingSymbols: string[]; tradeCount: number; lastReceivedTimestamp: string | null; connectionStatus: string; errorCount: number } {
    const sessions = latestCollectionRuns(this.db, date);
    const expectedInstruments = this.listStocks().length;
    const received = new Set(sessions.filter((run) => run.status === 'complete' && run.symbol).map((run) => run.symbol as string));
    const missingSymbols = this.listStocks().map((stock) => stock.symbol).filter((symbol) => !received.has(symbol));
    const aggregate = date ? this.db.prepare('SELECT COUNT(*) AS count, MAX(timestamp) AS last FROM trades WHERE trade_date = ?').get(date) as { count?: number; last?: string | null } : this.db.prepare('SELECT COUNT(*) AS count, MAX(timestamp) AS last FROM trades').get() as { count?: number; last?: string | null };
    return {
      provider: this.provider.name ?? this.dataMode, dataMode: this.dataMode, calculationMode: this.calculationMode, sessions,
      expectedInstruments, receivedInstruments: received.size, missingSymbols, tradeCount: Number(aggregate.count ?? 0), lastReceivedTimestamp: aggregate.last ?? null,
      connectionStatus: sessions.some((run) => run.status === 'failed') ? 'DEGRADED' : received.size ? 'CONNECTED' : 'IDLE', errorCount: sessions.filter((run) => run.status === 'failed').length
    };
  }
  collect(date?: string, symbol?: string): ReturnType<MarketService['collectionStatus']> {
    const resolved = this.resolveDate(date);
    if (!resolved.holiday) this.ensureSession(resolved.date, symbol);
    return this.collectionStatus(resolved.date);
  }
  analyze(date?: string, symbol?: string): { date: string; processed: number; results: VolumeProfile[]; status: string } {
    const resolved = this.resolveDate(date);
    if (resolved.holiday) return { date: resolved.date, processed: 0, results: [], status: 'No trading session' };
    const symbols = symbol ? [symbol.toUpperCase()] : this.listStocks().map((stock) => stock.symbol);
    const results = symbols.map((currentSymbol) => this.profile(currentSymbol, resolved.date)).filter((profile): profile is VolumeProfile => profile !== null);
    return { date: resolved.date, processed: results.length, results, status: results.length ? 'complete' : 'missing' };
  }
  sessions(limit = 100): Array<{ tradingDate: string; previousTradingDate: string; status: string }> {
    return (this.db.prepare('SELECT trading_date, previous_session_date, session_status FROM trading_sessions ORDER BY trading_date DESC LIMIT ?').all(Math.max(1, Math.floor(limit))) as Array<Record<string, unknown>>).map((row) => ({ tradingDate: String(row.trading_date), previousTradingDate: String(row.previous_session_date), status: String(row.session_status) }));
  }
  session(date: string): { tradingDate: string; previousTradingDate: string; status: string; timezone: string; sessionStart: string; sessionEnd: string } {
    const resolved = this.resolveDate(date);
    return { tradingDate: resolved.date, previousTradingDate: resolved.previousSessionDate, status: resolved.holiday ? 'No trading session' : this.sessionStatus(resolved.date), timezone: 'Asia/Kolkata', sessionStart: `${resolved.date}T09:15:00+05:30`, sessionEnd: `${resolved.date}T15:30:00+05:30` };
  }
  history(symbol?: string, limit = 100): VolumeProfile[] {
    const rows = this.db.prepare(`SELECT result_json FROM analysis_results ${symbol ? 'WHERE symbol = ?' : ''} ORDER BY calculated_at DESC LIMIT ?`).all(...(symbol ? [symbol.toUpperCase(), Math.max(1, Math.floor(limit))] : [Math.max(1, Math.floor(limit))])) as Array<{ result_json: string }>;
    return rows.map((row) => JSON.parse(row.result_json) as VolumeProfile);
  }

  appendSimulatedTrades(trades: Trade[]): void { persistTrades(this.db, trades, 'simulated'); }
  invalidate(date?: string): void {
    if (date) {
      for (const marker of this.ensuredSymbols) if (marker.startsWith(`${date}:`)) this.ensuredSymbols.delete(marker);
    } else this.ensuredSymbols.clear();
  }
}

export type BetterSqliteDatabase = Database.Database;
