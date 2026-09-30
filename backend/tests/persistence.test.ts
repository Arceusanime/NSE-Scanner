import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, hasBaseline, persistBaseline, seedDatabase, type SqliteDatabase } from '../src/database/database.js';
import { MarketService } from '../src/services/marketService.js';
import { fixtureProvider, fixtureTrade, TEST_DATE } from './helpers.js';

describe('baseline collection integrity', () => {
  let db: SqliteDatabase;
  const setup = () => {
    db = createDatabase(':memory:');
    const provider = fixtureProvider();
    seedDatabase(db, provider);
    return new MarketService(db, provider, TEST_DATE);
  };
  afterEach(() => db?.close());

  it('keeps completed baseline retries idempotent without overwriting the reference open', () => {
    const service = setup();
    const trades = [fixtureTrade('ABOVE', 100.05, 20), fixtureTrade('ABOVE', 99.95, 30, 1)];
    persistBaseline(db, 'ABOVE', TEST_DATE, trades, 100);
    persistBaseline(db, 'ABOVE', TEST_DATE, [...trades, fixtureTrade('ABOVE', 101, 500, 2)], 999);
    expect(hasBaseline(db, 'ABOVE', TEST_DATE)).toBe(true);
    expect(service.profile('ABOVE')).toMatchObject({ tradeCount: 2, totalVolume: 50, previousOpen: 100 });
  });

  it('isolates the same instrument across sessions and preserves integer-paise storage', () => {
    const service = setup();
    persistBaseline(db, 'ABOVE', TEST_DATE, [fixtureTrade('ABOVE', 100.05, 17)], 99.95);
    persistBaseline(db, 'ABOVE', '2025-01-16', [
      { ...fixtureTrade('ABOVE', 101.15, 23), tradeDate: '2025-01-16', timestamp: '2025-01-16T03:45:00.000Z' }
    ], 100.05);
    expect(service.profile('ABOVE', TEST_DATE, 0.05)).toMatchObject({ totalVolume: 17, previousOpen: 99.95 });
    expect(service.profile('ABOVE', '2025-01-16', 0.05)).toMatchObject({ totalVolume: 23, previousOpen: 100.05 });
    expect(db.prepare('SELECT price FROM trades ORDER BY trade_date').all()).toEqual([{ price: 10005 }, { price: 10115 }]);
    expect(service.getTrades('ABOVE', TEST_DATE)[0].price).toBe(100.05);
  });

  it('does not count a repeated provider trade ID twice during baseline ingestion', () => {
    setup();
    const first = { ...fixtureTrade('ABOVE', 100.05, 20), id: 7042 };
    const duplicate = { ...first, quantity: 2000 };
    persistBaseline(db, 'ABOVE', TEST_DATE, [first, duplicate], 100);
    // A replay/correction with the same provider identifier must not inflate the profile.
    expect(new MarketService(db, fixtureProvider(), TEST_DATE).profile('ABOVE')).toMatchObject({ tradeCount: 1, totalVolume: 20 });
  });

  it('retains completion markers for genuinely empty and missing-open sessions', () => {
    const service = setup();
    persistBaseline(db, 'EMPTY', TEST_DATE, [], null);
    expect(hasBaseline(db, 'EMPTY', TEST_DATE)).toBe(true);
    expect(service.profile('EMPTY')).toMatchObject({ tradeCount: 0, totalVolume: 0, previousOpen: null });
    expect(service.getTrades('EMPTY')).toEqual([]);
  });
});
