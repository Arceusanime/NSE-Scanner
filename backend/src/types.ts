export type MaybePromise<T> = T | Promise<T>;

export type UnderlyingType = 'STOCK' | 'INDEX';

export interface Stock {
  symbol: string;
  /** Display name; providerSymbol is retained separately for provider mapping. */
  name: string;
  exchange: 'NSE';
  segment?: 'CM' | 'FO';
  sector: string;
  instrumentType: 'EQUITY' | 'FUTURES' | 'INDEX';
  underlyingType?: UnderlyingType;
  lotSize: number;
  tickSize?: number;
  isFno: boolean;
  providerSymbol?: string;
  activeFrom?: string | null;
  activeTo?: string | null;
  /** Kept for compatibility; the session-specific value lives in trading_sessions. */
  previousOpen?: number | null;
}

export interface Trade {
  /** Local database identity. It is not necessarily the provider event identity. */
  id?: number;
  providerTradeId?: string;
  symbol: string;
  exchange?: 'NSE';
  segment?: 'CM' | 'FO';
  instrument?: string;
  tradeDate: string;
  timestamp: string;
  /** Prices are represented in rupees at the provider boundary and stored as integer paise. */
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  source?: 'baseline' | 'simulated' | 'historical' | 'live';
}

export interface VolumeLevel {
  price: number;
  /** `volume` is the historical API name; it is always total executed quantity. */
  volume: number;
  totalQuantity?: number;
  tradeCount: number;
  volumePercent: number;
  /** One-based rank within the requested directional/global result. */
  rank?: number;
  side?: 'ABOVE' | 'BELOW';
  signedGap?: number;
  pointGap?: number;
  gapPercent?: number;
  buyVolume?: number;
  sellVolume?: number;
}

export type SessionStatus = 'ok' | 'No trade data available' | 'Previous open unavailable' | 'Low liquidity' | 'No trading session';
export type DataQualityStatus = 'complete' | 'partial' | 'estimated' | 'missing' | 'invalid' | 'unavailable';
export interface DataQuality {
  /** Lowercase status is retained for compatibility; state is the V1 display/API enum. */
  status: DataQualityStatus;
  state?: 'COMPLETE' | 'PARTIAL' | 'ESTIMATED' | 'MISSING' | 'INVALID';
  label: string;
  reason?: string;
  tradeCount: number;
  hasPreviousOpen: boolean;
  source: string;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  expectedInstruments?: number;
  receivedInstruments?: number;
}
export const ANALYSIS_VERSION = 'v1.0.0';

export interface VolumeProfile {
  symbol: string;
  name?: string;
  sector?: string;
  exchange?: 'NSE';
  instrumentType?: 'EQUITY' | 'FUTURES';
  lotSize?: number;
  isFno?: boolean;
  date: string;
  requestedDate?: string;
  previousSessionDate: string;
  bucket: number;
  totalVolume: number;
  tradeCount: number;
  levels: VolumeLevel[];
  topLevels: VolumeLevel[];
  /** Requested global ranking size; retained for analysis cache/version keys. */
  topLevelsRequested?: number;
  /** Highest-volume levels strictly above and below previousOpen. */
  aboveLevels: VolumeLevel[];
  belowLevels: VolumeLevel[];
  aboveVolume: number;
  belowVolume: number;
  aboveGap: number | null;
  belowGap: number | null;
  hvtp: number | null;
  hvtpVolume: number;
  hvtpLevels: number[];
  previousDayOpen: number | null;
  previousOpen: number | null;
  signedGap: number | null;
  pointGap: number | null;
  gapPercent: number | null;
  currentPrice: number | null;
  currentVsHvtp: number | null;
  status: SessionStatus;
  dataQuality: DataQuality;
  /** Compatibility alias for clients that called this field quality. */
  quality: DataQuality;
  missingReason?: string;
  analysisVersion: string;
  currentPriceTimestamp: string | null;
  priceSeries: Array<{ time: string; price: number; volume: number }>;
  calculationMode: 'exact' | 'approximate';
  dataMode: 'mock' | 'real' | 'custom';
}

export interface ScannerRow extends Omit<VolumeProfile, 'levels' | 'priceSeries'> {
  /** Top levels are included in every scanner row for the terminal table. */
  topLevels: VolumeLevel[];
}

export interface Overview {
  scanned: number;
  above: number;
  below: number;
  unchanged: number;
  largestGap: number | null;
  smallestGap: number | null;
  averageGap: number | null;
  withLevels?: number;
  missing?: number;
}

export interface ScannerEnvelope {
  rows: ScannerRow[];
  count: number;
  date: string;
  requestedDate: string;
  previousSessionDate: string;
  defaultDate: string;
  sessionStatus: SessionStatus;
  dataMode: 'mock' | 'real' | 'custom';
  calculationMode: 'exact' | 'approximate';
  analysisVersion: string;
  dataQuality?: DataQuality;
  overview: Overview;
  rankings: {
    largestGaps: ScannerRow[];
    highestVolume: ScannerRow[];
    closestToOpen: ScannerRow[];
  };
}

export interface MarketDataProvider {
  /** Identifies provenance in every API response; mock is the offline default. */
  readonly dataMode?: 'mock' | 'real' | 'custom';
  readonly calculationMode?: 'exact' | 'approximate';
  readonly name?: string;
  getStocks(): MaybePromise<Stock[]>;
  getInstrumentUniverse?(): MaybePromise<Stock[]>;
  getTrades(symbol: string, date: string): MaybePromise<Trade[]>;
  getPreviousOpen(symbol: string, date: string): MaybePromise<number | null>;
  /** Optional aliases used by real adapters and live replay implementations. */
  getHistoricalTrades?(symbol: string, date: string): MaybePromise<Trade[]>;
  getIntradayTrades?(symbol: string, date: string): MaybePromise<Trade[]>;
  subscribeToTrades?(instruments: Stock[], onTrade: (trade: Trade) => void): MaybePromise<void>;
  getCurrentQuote?(instrument: Stock): MaybePromise<{ symbol: string; price: number; timestamp: string; change?: number | null; changePercent?: number | null }>;
}

export interface ScannerQuery {
  date?: string;
  bucket?: number;
  topLevels?: number;
  sort?: string;
  order?: string;
  direction?: string;
  minVolume?: number;
  limit?: number | 'all';
  sector?: string;
  query?: string;
  liquidityThreshold?: number;
}
