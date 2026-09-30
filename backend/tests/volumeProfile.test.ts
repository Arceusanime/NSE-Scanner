import { describe, expect, it } from 'vitest';
import { calculateVolumeProfile } from '../src/services/volumeProfile.js';
import type { Trade, VolumeLevel, VolumeProfile } from '../src/types.js';

const trade = (price: number, quantity: number, i: number): Trade => ({ symbol: 'TEST', tradeDate: '2025-01-15', timestamp: `2025-01-15T09:15:${String(i).padStart(2, '0')}.000Z`, price, quantity, side: i % 2 ? 'SELL' : 'BUY' });

describe('exact volume-at-price calculation', () => {
  it('aggregates quantities into rounded buckets and preserves totals', () => {
    const profile = calculateVolumeProfile('TEST', '2025-01-15', [trade(100.1, 20, 1), trade(100.4, 30, 2), trade(101.1, 15, 3)], { bucket: 1 });
    expect(profile.totalVolume).toBe(65);
    expect(profile.tradeCount).toBe(3);
    expect(profile.levels).toEqual(expect.arrayContaining([expect.objectContaining({ price: 100, volume: 50 }), expect.objectContaining({ price: 101, volume: 15 })]));
    expect(profile.hvtp).toBe(100);
  });

  it('uses nearest integer-paise buckets including midpoint rounding', () => {
    const profile = calculateVolumeProfile('TEST', '2025-01-15', [trade(100.02, 10, 1), trade(100.03, 20, 2), trade(100.07, 30, 3)], { bucket: 0.05 });
    expect(profile.levels.map(({ price, volume }) => [price, volume])).toEqual([[100, 10], [100.05, 50]]);
    expect(calculateVolumeProfile('TEST', '2025-01-15', [trade(100.5, 1, 0)], { bucket: 1 }).hvtp).toBe(101);
    expect(profile.levels.reduce((sum, level) => sum + level.buyVolume! + level.sellVolume!, 0)).toBe(60);
  });

  it('normalizes fractional observations to integer-paise bucket ticks', () => {
    const profile = calculateVolumeProfile('TEST', '2025-01-15', [
      trade(100.024, 10, 1), trade(100.026, 20, 2), trade(100.074, 30, 3)
    ], { bucket: 0.05 });
    expect(profile.levels.map(({ price, volume }) => [price, volume])).toEqual([[100, 30], [100.05, 30]]);
    expect(profile.levels.every((level) => Number.isInteger(Math.round(level.price * 100)) && Math.round(level.price * 100) % 5 === 0)).toBe(true);
    expect(profile.totalVolume).toBe(60);
  });

  it('breaks ties by closest previous open, then the lower price, including top levels', () => {
    const trades = [trade(90, 10, 1), trade(100, 10, 2), trade(110, 10, 3)];
    const nearest = calculateVolumeProfile('TEST', '2025-01-15', trades, { previousOpen: 108 });
    expect(nearest.hvtpLevels).toEqual([110, 100, 90]);
    expect(nearest.hvtp).toBe(110);
    expect(nearest.topLevels.map((level) => level.price)).toEqual([110, 100, 90]);
    const equidistant = calculateVolumeProfile('TEST', '2025-01-15', trades, { previousOpen: 105 });
    expect(equidistant.hvtpLevels).toEqual([100, 110, 90]);
    expect(equidistant.hvtp).toBe(100);
  });

  it('returns at most three highest-volume levels on each strict side of the reference', () => {
    const trades = [
      trade(100, 900, 0), // The open itself is never an above/below level.
      trade(101, 40, 1), trade(102, 40, 2), trade(103, 20, 3), trade(104, 10, 4),
      trade(99, 40, 5), trade(98, 40, 6), trade(97, 20, 7), trade(96, 10, 8),
    ];
    const profile = calculateVolumeProfile('TEST', '2025-01-15', trades, { previousOpen: 100, topLevels: 3 }) as VolumeProfile & { aboveLevels?: VolumeLevel[]; belowLevels?: VolumeLevel[] };
    // V1 exposes independently ranked levels on each side; the reference is excluded strictly.
    expect(profile.aboveLevels?.map((level) => level.price)).toEqual([101, 102, 103]);
    expect(profile.belowLevels?.map((level) => level.price)).toEqual([99, 98, 97]);
    expect(profile.aboveLevels?.every((level) => level.price > 100)).toBe(true);
    expect(profile.belowLevels?.every((level) => level.price < 100)).toBe(true);
    expect(profile.aboveLevels?.every((level) => level.price !== 100)).toBe(true);
    expect(profile.belowLevels?.every((level) => level.price !== 100)).toBe(true);
  });

  it('keeps signed/absolute gaps and last chronological print consistent', () => {
    const profile = calculateVolumeProfile('TEST', '2025-01-15', [trade(101, 5, 3), trade(90, 20, 1), trade(99, 5, 2)], { previousOpen: 100 });
    expect(profile).toMatchObject({ signedGap: -10, pointGap: 10, gapPercent: -10, currentPrice: 101, currentVsHvtp: 11 });
    expect(profile.priceSeries.map((point) => point.price)).toEqual([90, 99, 101]);
  });

  it('returns explicit null metrics rather than invented prices for empty/missing data', () => {
    const empty = calculateVolumeProfile('TEST', '2025-01-15', [], { previousOpen: 100 });
    expect(empty).toMatchObject({ status: 'No trade data available', hvtp: null, hvtpVolume: 0, signedGap: null, pointGap: null, gapPercent: null, currentPrice: null, currentVsHvtp: null, levels: [], topLevels: [], hvtpLevels: [], priceSeries: [] });
    const missing = calculateVolumeProfile('TEST', '2025-01-15', [trade(100, 20, 1)]);
    expect(missing).toMatchObject({ hvtp: 100, previousOpen: null, pointGap: null, gapPercent: null });
  });

  it('reports all equally highest-volume prices for ties', () => {
    const profile = calculateVolumeProfile('TEST', '2025-01-15', [trade(100, 10, 1), trade(101, 10, 2)], { bucket: 1 });
    expect(profile.hvtpLevels).toEqual([100, 101]);
    expect(profile.hvtp).toBe(100);
    expect(profile.hvtpVolume).toBe(10);
  });
});
