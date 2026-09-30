import { describe, expect, it, afterEach } from 'vitest';
import { createDatabase, persistBaseline, seedDatabase, type SqliteDatabase } from '../src/database/database.js';
import { MockMarketDataProvider, MOCK_TRADES_PER_SYMBOL } from '../src/providers/MockMarketDataProvider.js';
import { MarketService } from '../src/services/marketService.js';
import { previousSession } from '../src/services/calendar.js';
import { TEST_DATE } from './helpers.js';

describe('deterministic mock provider', () => {
  let db: SqliteDatabase | undefined;
  afterEach(() => db?.close());

  it('generates exact stable records and supplies the previous session opening print in rupees', () => {
    const provider = new MockMarketDataProvider();
    const trades = provider.getTrades('RELIANCE', TEST_DATE);
    expect(trades).toHaveLength(MOCK_TRADES_PER_SYMBOL);
    expect(trades).toEqual(new MockMarketDataProvider().getTrades('RELIANCE', TEST_DATE));
    expect(trades.every((trade) => Number.isInteger(trade.quantity) && trade.quantity > 0 && Math.round(trade.price * 100) % 5 === 0)).toBe(true);
    // These observations must not be regenerated differently by the metadata fix.
    expect(trades.at(-1)?.price).toBe(1245.4);
    for (const date of [TEST_DATE, '2025-08-18', '1970-01-01']) {
      const previousTrades = provider.getTrades('RELIANCE', previousSession(date));
      expect(provider.getPreviousOpen('RELIANCE', date)).toBe(previousTrades[0].price);
    }
    expect(provider.getPreviousOpen('RELIANCE', TEST_DATE)).toBe(1292.05);
    expect(provider.getTrades('RELIANCE', '2025-02-30')).toEqual([]);
    expect(provider.getPreviousOpen('RELIANCE', '2025-08-15')).toBeNull();
  });

  it('repairs version-zero cached mock opens without altering persisted observations', () => {
    db = createDatabase(':memory:');
    const provider = new MockMarketDataProvider();
    seedDatabase(db, provider);
    const original = provider.getTrades('RELIANCE', TEST_DATE);
    persistBaseline(db, 'RELIANCE', TEST_DATE, original, 125115);
    db.pragma('user_version = 0');
    const before = db.prepare('SELECT * FROM trades').all();
    seedDatabase(db, provider);
    const service = new MarketService(db, provider, TEST_DATE);
    expect(service.profile('RELIANCE')?.previousOpen).toBe(1292.05);
    expect(db.prepare('SELECT * FROM trades').all()).toEqual(before);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    seedDatabase(db, provider);
    expect(service.profile('RELIANCE')?.tradeCount).toBe(original.length);
  });
});
