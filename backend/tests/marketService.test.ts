import { describe, expect, it, afterEach, vi } from 'vitest';
import { createDatabase, persistTrades, seedDatabase, type SqliteDatabase } from '../src/database/database.js';
import { MarketService } from '../src/services/marketService.js';
import { fixtureProvider, fixtureTrade, TEST_DATE } from './helpers.js';

describe('scanner and persistence integration', () => {
  let db: SqliteDatabase;
  const setup = () => {
    db = createDatabase(':memory:');
    const provider = fixtureProvider();
    seedDatabase(db, provider);
    return { provider, service: new MarketService(db, provider, TEST_DATE) };
  };
  afterEach(() => { db?.close(); vi.useRealTimers(); });

  it('keeps null metrics out of gap rankings and removes full profiles from summaries', () => {
    const { service } = setup();
    const scanner = service.scanner({ liquidityThreshold: 0 });
    expect(scanner.rankings.largestGaps.map((row) => row.symbol)).toEqual(['BELOW', 'ABOVE', 'LOW']);
    expect(scanner.rankings.closestToOpen.map((row) => row.symbol)).toEqual(['LOW', 'ABOVE', 'BELOW']);
    expect(scanner.rankings.highestVolume.some((row) => row.symbol === 'EMPTY')).toBe(false);
    for (const row of [...scanner.rows, ...scanner.rankings.largestGaps]) {
      expect(row).not.toHaveProperty('levels');
      expect(row).not.toHaveProperty('priceSeries');
    }
    expect(service.profile('ABOVE')).toHaveProperty('levels');
    expect(service.scanner().rankings.highestVolume.find((row) => row.symbol === 'LOW')?.status).toBe('Low liquidity');
    expect(service.profile('MISSING')?.status).toBe('Previous open unavailable');
    expect(service.profile('EMPTY')?.status).toBe('No trade data available');
  });

  it.each(['pointGap', 'hvtpVolume', 'gapPercent', 'symbol', 'previousOpen', 'hvtp', 'signedGap', 'currentPrice', 'currentVsHvtp'])('sorts %s consistently with missing values last', (sort) => {
    const { service } = setup();
    for (const order of ['asc', 'desc']) {
      const rows = service.scanner({ sort, order, liquidityThreshold: 0 }).rows;
      const values = rows.map((row) => row[sort as keyof typeof row] as number | string | null);
      const firstNull = values.indexOf(null);
      if (firstNull !== -1) expect(values.slice(firstNull).every((value) => value === null)).toBe(true);
      const actual = values.filter((value): value is number | string => value !== null);
      const expected = [...actual].sort((a, b) => (typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : Number(a) - Number(b)) * (order === 'asc' ? 1 : -1));
      expect(actual).toEqual(expected);
    }
  });

  it('uses completion markers to avoid refetching empty sessions after a service restart', () => {
    const { provider, service } = setup();
    const getTrades = vi.spyOn(provider, 'getTrades');
    service.profile('EMPTY');
    expect(getTrades).toHaveBeenCalledTimes(1);
    new MarketService(db, provider, TEST_DATE).profile('EMPTY');
    expect(getTrades).toHaveBeenCalledTimes(1);
  });

  it('does not mistake simulated rows for a completed baseline', () => {
    const { service } = setup();
    persistTrades(db, [fixtureTrade('ABOVE', 111, 1)]);
    const profile = service.profile('ABOVE');
    expect(profile).toMatchObject({ previousOpen: 100, tradeCount: 3, totalVolume: 300001 });
    service.profile('ABOVE');
    expect(service.getTrades('ABOVE')).toHaveLength(3);
  });

  it('returns the true latest and complete history beyond 10,000 observations', () => {
    const { service } = setup();
    service.profile('ABOVE');
    const trades = Array.from({ length: 10001 }, (_, i) => ({ ...fixtureTrade('ABOVE', 111, 1, i + 2), source: 'simulated' as const }));
    service.appendSimulatedTrades(trades);
    expect(service.getTrades('ABOVE')).toHaveLength(10003);
    expect(service.getLatestTrade('ABOVE')).toMatchObject(trades.at(-1)!);
    expect(service.profile('ABOVE')?.tradeCount).toBe(10003);
  });

  it('rolls an unpinned default date forward at IST midnight without a server restart', () => {
    const { provider } = setup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T18:29:00Z'));
    const service = new MarketService(db, provider);
    expect(service.defaultDate()).toBe('2025-01-14');
    vi.setSystemTime(new Date('2025-01-15T18:31:00Z'));
    expect(service.defaultDate()).toBe(TEST_DATE);
    expect(service.resolveDate().date).toBe(TEST_DATE);
  });

  it('invalidates only the requested in-memory session marker, or all markers when omitted', () => {
    const { service } = setup();
    service.profile('ABOVE', '2025-01-14');
    service.profile('ABOVE', TEST_DATE);
    const removeBaseline = (date: string) => {
      db.prepare('DELETE FROM session_opens WHERE symbol = ? AND trading_date = ?').run('ABOVE', date);
      db.prepare('DELETE FROM trades WHERE symbol = ? AND trade_date = ?').run('ABOVE', date);
    };
    removeBaseline('2025-01-14');
    service.invalidate(TEST_DATE);
    expect(service.profile('ABOVE', '2025-01-14')?.tradeCount).toBe(0);
    service.invalidate();
    expect(service.profile('ABOVE', '2025-01-14')?.tradeCount).toBe(2);
  });
});
