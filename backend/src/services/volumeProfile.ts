import { ANALYSIS_VERSION, type DataQuality, type Trade, type VolumeLevel, type VolumeProfile } from '../types.js';

export interface VolumeProfileOptions {
  bucket?: number;
  topLevels?: number;
  previousOpen?: number | null;
  threshold?: number;
  dataMode?: VolumeProfile['dataMode'];
  calculationMode?: VolumeProfile['calculationMode'];
  source?: string;
  dataQuality?: Partial<DataQuality>;
}
export const ALLOWED_BUCKETS = [0.05, 1, 5, 10] as const;
export const ALLOWED_TOP_LEVELS = [1, 3, 5, 10] as const;
export const DIRECTIONAL_LEVEL_LIMIT = 3;

export function normalizeBucket(value?: number): number {
  return value !== undefined && ALLOWED_BUCKETS.includes(value as typeof ALLOWED_BUCKETS[number]) ? value : 1;
}
export function normalizeTopLevels(value?: number): number {
  return value !== undefined && ALLOWED_TOP_LEVELS.includes(value as typeof ALLOWED_TOP_LEVELS[number]) ? value : 3;
}
/** Real exchange ticks are integral paise. Preserve valid two-decimal values while conservatively truncating malformed sub-paise observations. */
function toPaise(price: number): number {
  const scaled = price * 100;
  return Math.abs(scaled - Math.round(scaled)) > 1e-8 ? Math.trunc(scaled + Number.EPSILON) : Math.round(scaled);
}
function fromPaise(price: number): number { return Number((price / 100).toFixed(2)); }
function round(value: number | null): number | null { return value === null ? null : Number(value.toFixed(2)); }
function sampleTrades(trades: Trade[], max = 400): Trade[] {
  if (trades.length <= max) return trades;
  const result: Trade[] = [];
  for (let i = 0; i < max; i += 1) result.push(trades[Math.floor(i * (trades.length - 1) / (max - 1))]);
  return result;
}

/** Exact trade aggregation. All arithmetic is integer paise/quantity until API serialization. */
export function calculateVolumeProfile(symbol: string, date: string, trades: Trade[], options: VolumeProfileOptions = {}): VolumeProfile {
  const bucket = normalizeBucket(options.bucket);
  const bucketPaise = Math.max(5, Math.round(bucket * 100));
  const grouped = new Map<number, { volume: number; tradeCount: number; buyVolume: number; sellVolume: number }>();
  let totalVolume = 0;
  const orderedTrades = [...trades].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || (a.id ?? 0) - (b.id ?? 0));
  for (const trade of orderedTrades) {
    const key = Math.round(toPaise(trade.price) / bucketPaise) * bucketPaise;
    const current = grouped.get(key) ?? { volume: 0, tradeCount: 0, buyVolume: 0, sellVolume: 0 };
    current.volume += Math.round(trade.quantity);
    current.tradeCount += 1;
    if (trade.side === 'BUY') current.buyVolume += Math.round(trade.quantity); else current.sellVolume += Math.round(trade.quantity);
    grouped.set(key, current);
    totalVolume += Math.round(trade.quantity);
  }
  const referencePaise = options.previousOpen === null || options.previousOpen === undefined ? null : toPaise(options.previousOpen);
  const levels: VolumeLevel[] = [...grouped.entries()].sort(([a], [b]) => a - b).map(([price, data]) => ({
    price: fromPaise(price), volume: data.volume, totalQuantity: data.volume, tradeCount: data.tradeCount,
    volumePercent: totalVolume ? Number((data.volume / totalVolume * 100).toFixed(4)) : 0,
    buyVolume: data.buyVolume, sellVolume: data.sellVolume
  }));
  const rank = (a: VolumeLevel, b: VolumeLevel): number => {
    if (b.volume !== a.volume) return b.volume - a.volume;
    if (referencePaise !== null) {
      const distance = Math.abs(toPaise(a.price) - referencePaise) - Math.abs(toPaise(b.price) - referencePaise);
      if (distance !== 0) return distance;
    }
    return a.price - b.price;
  };
  const ranked = [...levels].sort(rank).map((level, index) => ({ ...level, rank: index + 1 }));
  const withGap = (level: VolumeLevel, side: 'ABOVE' | 'BELOW', index: number): VolumeLevel => {
    if (referencePaise === null) return { ...level, side, rank: index + 1 };
    const signedGap = round(level.price - fromPaise(referencePaise)) ?? 0;
    return {
      ...level,
      side,
      rank: index + 1,
      signedGap,
      pointGap: Math.abs(signedGap),
      gapPercent: fromPaise(referencePaise) === 0 ? undefined : round(Math.abs(signedGap) / fromPaise(referencePaise) * 100) ?? undefined,
    };
  };
  const directional = (direction: 'above' | 'below'): VolumeLevel[] => {
    if (referencePaise === null) return [];
    return ranked.filter((level) => direction === 'above' ? toPaise(level.price) > referencePaise : toPaise(level.price) < referencePaise)
      .slice(0, DIRECTIONAL_LEVEL_LIMIT).map((level, index) => withGap(level, direction === 'above' ? 'ABOVE' : 'BELOW', index));
  };
  const aboveLevels = directional('above');
  const belowLevels = directional('below');
  const hvtpVolume = levels.length ? Math.max(...levels.map((level) => level.volume)) : 0;
  const hvtpLevels = levels.filter((level) => level.volume === hvtpVolume).sort((a, b) => {
    if (referencePaise !== null) return Math.abs(toPaise(a.price) - referencePaise) - Math.abs(toPaise(b.price) - referencePaise) || a.price - b.price;
    return a.price - b.price;
  }).map((level) => level.price);
  const hvtp = hvtpLevels[0] ?? null;
  const currentTrade = orderedTrades.at(-1);
  const current = currentTrade?.price ?? null;
  const signedGap = hvtp === null || referencePaise === null ? null : round(hvtp - fromPaise(referencePaise));
  const complete = orderedTrades.length > 0 && referencePaise !== null;
  const quality: DataQuality = {
    status: complete ? 'complete' : orderedTrades.length || referencePaise !== null ? 'partial' : 'unavailable',
    state: complete ? 'COMPLETE' : orderedTrades.length ? 'PARTIAL' : 'MISSING',
    label: complete ? 'Complete' : orderedTrades.length ? 'Previous open unavailable' : 'Missing',
    reason: orderedTrades.length ? referencePaise === null ? 'previous_open_unavailable' : undefined : 'no_trade_data',
    tradeCount: orderedTrades.length, hasPreviousOpen: referencePaise !== null, source: options.source ?? options.dataMode ?? 'mock',
    coverageStart: orderedTrades[0]?.timestamp ?? null, coverageEnd: orderedTrades.at(-1)?.timestamp ?? null,
  };
  const profile: VolumeProfile = {
    symbol, date, previousSessionDate: '', bucket, totalVolume, tradeCount: orderedTrades.length,
    levels, topLevels: ranked.slice(0, normalizeTopLevels(options.topLevels)), topLevelsRequested: normalizeTopLevels(options.topLevels), aboveLevels, belowLevels,
    aboveVolume: aboveLevels.reduce((sum, level) => sum + level.volume, 0), belowVolume: belowLevels.reduce((sum, level) => sum + level.volume, 0),
    aboveGap: aboveLevels[0] && referencePaise !== null ? round(aboveLevels[0].price - fromPaise(referencePaise)) : null,
    belowGap: belowLevels[0] && referencePaise !== null ? round(fromPaise(referencePaise) - belowLevels[0].price) : null,
    hvtp, hvtpVolume, hvtpLevels,
    previousDayOpen: options.previousOpen ?? null, previousOpen: options.previousOpen ?? null,
    signedGap, pointGap: signedGap === null ? null : Math.abs(signedGap),
    gapPercent: signedGap === null || referencePaise === null || referencePaise === 0 ? null : round(signedGap / fromPaise(referencePaise) * 100),
    currentPrice: current === null ? null : Number(current.toFixed(2)), currentPriceTimestamp: currentTrade?.timestamp ?? null,
    currentVsHvtp: current === null || hvtp === null ? null : round(current - hvtp), status: orderedTrades.length ? 'ok' : 'No trade data available',
    dataQuality: quality, quality, missingReason: quality.reason, analysisVersion: ANALYSIS_VERSION,
    priceSeries: sampleTrades(orderedTrades).map((trade) => ({ time: trade.timestamp, price: Number(trade.price.toFixed(2)), volume: trade.quantity })),
    calculationMode: options.calculationMode ?? 'exact', dataMode: options.dataMode ?? 'mock'
  };
  return profile;
}
