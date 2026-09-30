import { Router, type Request } from 'express';
import type { MarketService } from '../services/marketService.js';
import { LiveSessionEngine } from '../services/liveSessionEngine.js';
import { ALLOWED_BUCKETS, ALLOWED_TOP_LEVELS } from '../services/volumeProfile.js';
import type { ScannerQuery } from '../types.js';
import { isValidDate } from '../services/calendar.js';

const scannerKeys = new Set(['date', 'bucket', 'topLevels', 'sort', 'order', 'direction', 'minVolume', 'limit', 'sector', 'query', 'liquidityThreshold']);
const profileKeys = new Set(['date', 'bucket', 'topLevels']);
const text = (value: unknown): string | undefined => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('query values must be single strings');
  return value;
};
const numeric = (value: unknown, name: string): number | undefined => {
  const input = text(value);
  if (input === undefined) return undefined;
  const result = Number(input);
  if (!input.trim() || !Number.isFinite(result)) throw new Error(`${name} must be numeric`);
  return result;
};
function rejectUnknown(query: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(query)) if (!allowed.has(key)) throw new Error(`unknown query parameter: ${key}`);
}
function date(value: unknown): string | undefined {
  const result = text(value); if (result === undefined) return undefined;
  if (!isValidDate(result)) throw new Error('date must be a real YYYY-MM-DD date between 1970 and 2100');
  return result;
}
function bucket(value: unknown): number | undefined {
  const result = numeric(value, 'bucket'); if (result === undefined) return undefined;
  if (!(ALLOWED_BUCKETS as readonly number[]).includes(result)) throw new Error('bucket must be one of 0.05, 1, 5, 10'); return result;
}
function topLevels(value: unknown): number | undefined {
  const result = numeric(value, 'topLevels'); if (result === undefined) return undefined;
  if (!(ALLOWED_TOP_LEVELS as readonly number[]).includes(result)) throw new Error('topLevels must be one of 1, 3, 5, 10'); return result;
}
function profileQuery(req: Request): { date?: string; bucket?: number; topLevels?: number } {
  rejectUnknown(req.query as Record<string, unknown>, profileKeys);
  return { date: date(req.query.date), bucket: bucket(req.query.bucket), topLevels: topLevels(req.query.topLevels) };
}
function scannerQuery(req: Request, live = false): ScannerQuery {
  rejectUnknown(req.query as Record<string, unknown>, live ? new Set([...scannerKeys, 'symbol']) : scannerKeys);
  const order = text(req.query.order); const direction = text(req.query.direction);
  if (order && !['asc', 'desc'].includes(order)) throw new Error('order must be asc or desc');
  if (direction && !['all', 'above', 'below'].includes(direction)) throw new Error('direction must be all, above, or below');
  const sort = text(req.query.sort);
  if (sort && !['pointGap', 'gapPercent', 'hvtpVolume', 'symbol', 'previousOpen', 'hvtp', 'signedGap', 'currentPrice', 'currentVsHvtp'].includes(sort)) throw new Error('unsupported sort field');
  const minVolume = numeric(req.query.minVolume, 'minVolume'); const liquidityThreshold = numeric(req.query.liquidityThreshold, 'liquidityThreshold');
  if (minVolume !== undefined && minVolume < 0) throw new Error('minVolume must be non-negative');
  if (liquidityThreshold !== undefined && liquidityThreshold < 0) throw new Error('liquidityThreshold must be non-negative');
  const limitRaw = text(req.query.limit); let limit: number | 'all' | undefined;
  if (limitRaw !== undefined) {
    if (limitRaw === 'all') limit = 'all';
    else { const n = Number(limitRaw); if (![10, 25, 50].includes(n)) throw new Error('limit must be 10, 25, 50, or all'); limit = n; }
  }
  return { date: date(req.query.date), bucket: bucket(req.query.bucket), topLevels: topLevels(req.query.topLevels), sort, order, direction, minVolume, limit, sector: text(req.query.sector), query: text(req.query.query), liquidityThreshold };
}

export function createApiRouter(service: MarketService, live: LiveSessionEngine): Router {
  const router = Router();
  router.get('/health', (_req, res) => res.json({ status: 'ok', defaultDate: service.defaultDate(), provider: service.collectionStatus().provider, dataMode: service.dataMode, calculationMode: service.calculationMode, analysisVersion: 'v1.0.0' }));
  router.get('/stocks', (_req, res) => { const stocks = service.listStocks(); res.json({ stocks, data: stocks, count: stocks.length, dataMode: service.dataMode, calculationMode: service.calculationMode, analysisVersion: 'v1.0.0' }); });
  router.get('/instruments', (_req, res) => { const instruments = service.listStocks(); res.json({ instruments, count: instruments.length, dataMode: service.dataMode, calculationMode: service.calculationMode, analysisVersion: 'v1.0.0' }); });
  router.get('/instruments/:symbol', (req, res) => {
    const instrument = service.getStock(req.params.symbol); if (!instrument) return res.status(404).json({ error: 'Unknown instrument symbol' });
    const q = profileQuery(req); return res.json({ instrument, analysis: service.profile(instrument.symbol, q.date, q.bucket, q.topLevels), dataMode: service.dataMode, calculationMode: service.calculationMode });
  });
  router.get('/stocks/:symbol', (req, res) => {
    const stock = service.getStock(req.params.symbol); if (!stock) return res.status(404).json({ error: 'Unknown stock symbol' });
    const q = profileQuery(req); return res.json({ stock, profile: service.profile(stock.symbol, q.date, q.bucket, q.topLevels), dataMode: service.dataMode, calculationMode: service.calculationMode, analysisVersion: 'v1.0.0' });
  });
  router.get('/market/previous-open/:symbol', (req, res) => {
    const stock = service.getStock(req.params.symbol); if (!stock) return res.status(404).json({ error: 'Unknown stock symbol' });
    const q = profileQuery(req); const profile = service.profile(stock.symbol, q.date, q.bucket, q.topLevels);
    return res.json({ symbol: stock.symbol, date: profile!.date, requestedDate: profile!.requestedDate, previousSessionDate: profile!.previousSessionDate, sessionStatus: profile!.status, previousOpen: profile!.previousOpen, previousDayOpen: profile!.previousDayOpen, dataQuality: profile!.dataQuality, dataMode: service.dataMode, calculationMode: service.calculationMode, analysisVersion: profile!.analysisVersion });
  });
  router.get('/trades/:symbol', (req, res) => {
    if (!service.getStock(req.params.symbol)) return res.status(404).json({ error: 'Unknown stock symbol' });
    rejectUnknown(req.query as Record<string, unknown>, new Set(['date', 'limit', 'offset']));
    const requested = date(req.query.date); const limit = numeric(req.query.limit, 'limit'); const offset = numeric(req.query.offset, 'offset');
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('limit must be a positive integer');
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) throw new Error('offset must be a non-negative integer');
    const trades = service.getTrades(req.params.symbol, requested, limit, offset); const resolved = service.resolveDate(requested);
    const sessionStatus = resolved.holiday ? 'No trading session' : service.getLatestTrade(req.params.symbol, requested) ? 'ok' : 'No trade data available';
    return res.json({ symbol: req.params.symbol.toUpperCase(), date: resolved.date, requestedDate: resolved.requestedDate, previousSessionDate: resolved.previousSessionDate, sessionStatus, trades, count: trades.length, dataMode: service.dataMode, calculationMode: service.calculationMode, analysisVersion: 'v1.0.0' });
  });
  router.get('/previous-open/:symbol', (req, res) => {
    const stock = service.getStock(req.params.symbol); if (!stock) return res.status(404).json({ error: 'Unknown stock symbol' });
    const q = profileQuery(req); const profile = service.profile(stock.symbol, q.date, q.bucket, q.topLevels);
    return res.json({ symbol: stock.symbol, date: profile!.date, requestedDate: profile!.requestedDate, previousSessionDate: profile!.previousSessionDate, sessionStatus: profile!.status, previousOpen: profile!.previousOpen, previousDayOpen: profile!.previousDayOpen, dataQuality: profile!.dataQuality, dataMode: service.dataMode, calculationMode: service.calculationMode, analysisVersion: profile!.analysisVersion });
  });
  router.get('/analysis/:symbol', (req, res) => {
    const stock = service.getStock(req.params.symbol); if (!stock) return res.status(404).json({ error: 'Unknown stock symbol' });
    const q = profileQuery(req); return res.json(service.profile(stock.symbol, q.date, q.bucket, q.topLevels));
  });
  router.get('/volume-profile/:symbol', (req, res) => {
    const stock = service.getStock(req.params.symbol); if (!stock) return res.status(404).json({ error: 'Unknown stock symbol' });
    const q = profileQuery(req); const profile = service.profile(stock.symbol, q.date, q.bucket, q.topLevels); return res.json(profile);
  });
  router.get('/sessions', (req, res) => {
    const limit = numeric(req.query.limit, 'limit');
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('limit must be a positive integer');
    return res.json({ sessions: service.sessions(limit), timezone: 'Asia/Kolkata' });
  });
  router.get('/sessions/:date', (req, res) => res.json(service.session(date(req.params.date)!)));
  router.get('/scanner', (req, res) => res.json(service.scanner(scannerQuery(req))));
  router.get('/levels', (req, res) => {
    const envelope = service.scanner({ ...scannerQuery(req), liquidityThreshold: 0, limit: 'all' });
    return res.json({ date: envelope.date, previousTradingDate: envelope.previousSessionDate, rows: envelope.rows, count: envelope.rows.length, dataQuality: envelope.dataQuality, dataMode: envelope.dataMode, calculationMode: envelope.calculationMode });
  });
  router.get('/levels/:symbol', (req, res) => {
    const stock = service.getStock(req.params.symbol); if (!stock) return res.status(404).json({ error: 'Unknown instrument symbol' });
    const q = profileQuery(req); return res.json(service.profile(stock.symbol, q.date, q.bucket, q.topLevels));
  });
  router.get('/monitor', (req, res) => {
    const requested = date(req.query.date);
    return res.json({ status: 'ok', ...service.collectionStatus(requested), date: requested ?? service.defaultDate(), lastCollection: service.collectionStatus(requested).sessions[0]?.completedAt ?? null });
  });
  router.get('/collection/status', (req, res) => res.json(service.collectionStatus(date(req.query.date))));
  router.get('/collection-status', (req, res) => res.json(service.collectionStatus(date(req.query.date))));
  router.get('/data-status', (req, res) => res.json(service.collectionStatus(date(req.query.date))));
  const jobDate = (req: Request): { date?: string; symbol?: string } => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const requestedDate = body.date ?? req.query.date;
    const symbolValue = body.symbol ?? req.query.symbol;
    const symbol = symbolValue === undefined ? undefined : text(symbolValue)?.toUpperCase();
    if (symbol && !service.getStock(symbol)) throw new Error('Unknown instrument symbol');
    return { date: date(requestedDate), symbol };
  };
  router.post('/jobs/collect', (req, res) => res.status(202).json({ job: 'collect', ...service.collect(jobDate(req).date, jobDate(req).symbol) }));
  router.post('/jobs/analyze', (req, res) => res.status(202).json({ job: 'analyze', ...service.analyze(jobDate(req).date, jobDate(req).symbol) }));
  router.post('/jobs/reprocess', (req, res) => res.status(202).json({ job: 'reprocess', ...service.analyze(jobDate(req).date, jobDate(req).symbol) }));
  const exportRows = (requested?: string) => {
    const envelope = service.scanner({ date: requested, limit: 'all', liquidityThreshold: 0 });
    return envelope.rows.flatMap((row) => [...row.aboveLevels, ...row.belowLevels].map((level) => ({ date: row.date, symbol: row.symbol, reference_price: row.previousDayOpen, side: level.side, rank: level.rank, level_price: level.price, volume: level.volume, trade_count: level.tradeCount, signed_gap: level.signedGap, point_gap: level.pointGap, gap_percent: level.gapPercent, data_quality: row.dataQuality?.state ?? row.dataQuality?.status ?? row.status })));
  };
  router.get('/export/levels.json', (req, res) => res.json({ rows: exportRows(date(req.query.date)), count: exportRows(date(req.query.date)).length }));
  router.get('/export/levels.csv', (req, res) => {
    const rows = exportRows(date(req.query.date)); const headers = ['date', 'symbol', 'reference_price', 'side', 'rank', 'level_price', 'volume', 'trade_count', 'signed_gap', 'point_gap', 'gap_percent', 'data_quality'];
    const escape = (value: unknown) => { const textValue = value == null ? '' : String(value); return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue; };
    const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => escape(row[header as keyof typeof row])).join(','))].join('\n');
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="levels.csv"').send(csv);
  });
  router.get('/history', (req, res) => {
    const symbol = text(req.query.symbol); const limit = numeric(req.query.limit, 'limit');
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('limit must be a positive integer');
    return res.json({ history: service.history(symbol, limit), count: service.history(symbol, limit).length, dataMode: service.dataMode, calculationMode: service.calculationMode });
  });
  router.get('/live', (req, res) => {
    const q = scannerQuery(req, true);
    const symbol = text(req.query.symbol); if (symbol && !service.getStock(symbol)) return res.status(404).json({ error: 'Unknown stock symbol' });
    const envelope = live.poll({ ...q, symbol });
    const latestTrade = symbol ? service.getLatestTrade(symbol, q.date) : null;
    return res.json({ ...envelope, latestTrade });
  });
  router.get('/live/stream', (req, res) => {
    const q = scannerQuery(req, true); const symbol = text(req.query.symbol);
    if (symbol && !service.getStock(symbol)) return res.status(404).json({ error: 'Unknown stock symbol' });
    const key = live.subscribe({ ...q, symbol }, res);
    res.on('close', () => live.unsubscribe(key));
    return undefined;
  });
  return router;
}
