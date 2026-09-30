import { describe, expect, it, afterEach, vi } from 'vitest';
import request from 'supertest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp, type AppContext } from '../src/app.js';
import { createDatabase } from '../src/database/database.js';
import { MOCK_STOCK_COUNT, MOCK_TRADES_PER_SYMBOL } from '../src/providers/MockMarketDataProvider.js';
import { fixtureProvider, TEST_DATE } from './helpers.js';

describe('market API', () => {
  let context: AppContext;
  const app = (mock = false) => {
    context = createApp({ db: createDatabase(':memory:'), defaultDate: TEST_DATE, ...(mock ? {} : { provider: fixtureProvider() }) });
    return request(context.app);
  };
  afterEach(() => { context?.live.close(); context?.db.close(); vi.restoreAllMocks(); });

  it('exposes health and the deterministic NSE F&O mock universe', async () => {
    const client = app(true);
    const health = await client.get('/api/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok', defaultDate: TEST_DATE, dataMode: 'mock', calculationMode: 'exact' });
    const stocks = await client.get('/api/stocks').expect(200);
    expect(stocks.body.stocks).toHaveLength(MOCK_STOCK_COUNT);
    expect(stocks.body.stocks.every((stock: { isFno: boolean }) => stock.isFno)).toBe(true);
  });

  it('honors pagination without truncating the complete exact profile', async () => {
    const client = app(true);
    const trades = await client.get('/api/trades/RELIANCE?limit=400').expect(200);
    expect(trades.body.trades).toHaveLength(400);
    const next = await client.get('/api/trades/reliance?limit=1&offset=400').expect(200);
    const all = await client.get('/api/trades/RELIANCE').expect(200);
    expect(all.body.count).toBe(MOCK_TRADES_PER_SYMBOL);
    expect(next.body.trades[0]).toEqual(all.body.trades[400]);
    const profile = await client.get('/api/volume-profile/RELIANCE?bucket=5&topLevels=3').expect(200);
    expect(profile.body).toMatchObject({ symbol: 'RELIANCE', calculationMode: 'exact', dataMode: 'mock', tradeCount: MOCK_TRADES_PER_SYMBOL });
    expect(profile.body.topLevels).toHaveLength(3);
    expect(profile.body.levels.length).toBeGreaterThan(3);
    expect(profile.body.totalVolume).toBe(all.body.trades.reduce((sum: number, trade: { quantity: number }) => sum + trade.quantity, 0));
    expect(profile.body.hvtpLevels.length).toBeGreaterThan(0);
    const previousTrades = await client.get(`/api/trades/RELIANCE?date=${profile.body.previousSessionDate}&limit=1`).expect(200);
    expect(profile.body.previousOpen).toBe(previousTrades.body.trades[0].price);
  });

  it('smoke-tests V1 side-level and gap fields over HTTP', async () => {
    const client = app();
    const profile = await client.get('/api/volume-profile/ABOVE?topLevels=3').expect(200);
    expect(profile.body).toMatchObject({ previousOpen: 100, signedGap: 5, pointGap: 5, gapPercent: 5 });
    expect(profile.body.aboveLevels).toEqual(expect.any(Array));
    expect(profile.body.belowLevels).toEqual(expect.any(Array));
    expect(profile.body.aboveLevels.length).toBeLessThanOrEqual(3);
    expect(profile.body.belowLevels.length).toBeLessThanOrEqual(3);
    expect(profile.body.aboveLevels.every((level: { price: number }) => level.price > profile.body.previousOpen)).toBe(true);
    expect(profile.body.belowLevels.every((level: { price: number }) => level.price < profile.body.previousOpen)).toBe(true);
    const missing = await client.get('/api/volume-profile/MISSING').expect(200);
    expect(missing.body).toMatchObject({ status: 'Previous open unavailable', signedGap: null, pointGap: null, gapPercent: null });
  });

  it('filters by HVTP quantity, direction, search, sector and limit; keeps the overview unfiltered', async () => {
    const client = app();
    const unfiltered = await client.get('/api/scanner?liquidityThreshold=0').expect(200);
    const filtered = await client.get('/api/scanner?minVolume=250000&sort=hvtpVolume&order=desc&limit=10').expect(200);
    expect(filtered.body.rows.map((row: { symbol: string }) => row.symbol)).toEqual(['BELOW']);
    expect(filtered.body.overview).toEqual(unfiltered.body.overview);
    expect(filtered.body.overview).toMatchObject({ scanned: 5, above: 1, below: 1, unchanged: 1, largestGap: 10, smallestGap: 0 });
    const sector = await client.get('/api/scanner?sector=Energy&direction=above&query=company').expect(200);
    expect(sector.body.rows.map((row: { symbol: string }) => row.symbol)).toEqual(['ABOVE']);
  });

  it('preserves requested/resolved/session context on all date-sensitive routes', async () => {
    const client = app();
    for (const path of ['/api/scanner', '/api/volume-profile/ABOVE', '/api/trades/ABOVE', '/api/market/previous-open/ABOVE']) {
      const response = await client.get(`${path}?date=2025-01-19`).expect(200);
      expect(response.body).toMatchObject({ requestedDate: '2025-01-19', date: '2025-01-17', previousSessionDate: '2025-01-16' });
    }
    const holiday = await client.get('/api/scanner?date=2025-08-15').expect(200);
    expect(holiday.body).toMatchObject({ sessionStatus: 'No trading session', rows: [] });
    const profile = await client.get('/api/volume-profile/ABOVE?date=2025-08-15').expect(200);
    expect(profile.body).toMatchObject({ status: 'No trading session', tradeCount: 0, previousOpen: null, hvtp: null });
  });

  it.each([
    '/api/scanner?date=2025-02-30', '/api/scanner?date=2101-01-01', '/api/scanner?date=invalid',
    '/api/scanner?date[]=2025-01-15', '/api/scanner?date=2025-01-15&date=2025-01-16',
    '/api/scanner?order[]=asc', '/api/scanner?sort[bad]=symbol', '/api/scanner?query[]=abc',
    '/api/scanner?bucket[]=5', '/api/scanner?bucket=2', '/api/scanner?topLevels=2',
    '/api/scanner?minVolume=-1', '/api/scanner?minVolume=Infinity', '/api/scanner?liquidityThreshold=-1',
    '/api/scanner?limit=5', '/api/scanner?direction=asc', '/api/scanner?order=up', '/api/scanner?sort=bogus',
    '/api/scanner?unexpected=1', '/api/trades/ABOVE?limit=1.5', '/api/trades/ABOVE?offset=0.5',
    '/api/trades/ABOVE?limit=0', '/api/trades/ABOVE?offset=-1', '/api/live?symbol[]=ABOVE',
    '/api/live/stream?date=2025-02-30'
  ])('returns JSON 400 for invalid query %s', async (path) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await app().get(path).expect(400);
    expect(response.body.error).toEqual(expect.any(String));
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('streams real HTTP updates with scanner query parameters and releases disconnected clients', async () => {
    app();
    const unsubscribe = vi.spyOn(context.live, 'unsubscribe');
    const server = context.app.listen(0, '127.0.0.1');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/api/live/stream?symbol=ABOVE&date=${TEST_DATE}&bucket=5&topLevels=3&sort=pointGap&order=desc&direction=above&minVolume=0&limit=10&liquidityThreshold=0`, { signal: controller.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const reader = response.body!.getReader();
      let received = '';
      while (received.split('\n\n').length < 3) {
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended before its second update');
        received += new TextDecoder().decode(value);
      }
      const updates = received.trim().split('\n\n').map((frame) => JSON.parse(frame.split('data: ')[1]));
      expect(updates[0]).toMatchObject({ simulated: true, sequence: 0, count: 1 });
      expect(updates[1]).toMatchObject({ simulated: true, sequence: 1, count: 1 });
      expect(updates[1].profile.currentPrice).toBe(updates[1].rows[0].currentPrice);
      await reader.cancel();
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled(), { timeout: 1000, interval: 10 });
  }, 10000);

  it('supports a finite simulated polling step using the same scanner filters as SSE', async () => {
    const client = app();
    const live = await client.get('/api/live?symbol=ABOVE&direction=above&sort=hvtpVolume&order=asc&limit=10&query=above&liquidityThreshold=0').expect(200);
    expect(live.body).toMatchObject({ simulated: true, sequence: 1, count: 1 });
    expect(live.body.latestTrade).toHaveProperty('symbol', 'ABOVE');
    expect(live.body.profile.currentPrice).toBe(live.body.latestTrade.price);
    expect(live.body.rows[0].currentPrice).toBe(live.body.profile.currentPrice);
    for (const path of ['/api/volume-profile/NOPE', '/api/stocks/NOPE', '/api/trades/NOPE', '/api/market/previous-open/NOPE', '/api/live?symbol=NOPE']) await client.get(path).expect(404);
  });
});
