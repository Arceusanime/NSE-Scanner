export interface Stock {
  symbol: string
  name: string
  exchange: string
  sector: string
  instrumentType: string
  underlyingType?: 'STOCK' | 'INDEX'
  segment?: string
  lotSize: number
  tickSize?: number
  providerSymbol?: string
  activeFrom?: string | null
  activeTo?: string | null
  isFno: boolean
  previousOpen?: number | null
}

export interface VolumeLevel {
  price: number
  volume: number
  tradeCount?: number
  volumePercent?: number
  rank?: number
  side?: 'ABOVE' | 'BELOW'
  signedGap?: number
  pointGap?: number
  gapPercent?: number
}

/** Optional fields accommodate partial provider responses and older local API versions. */
export interface ScannerRow {
  symbol: string
  name: string
  sector: string
  previousDayOpen: number | null
  previousOpen: number | null
  aboveLevels?: VolumeLevel[]
  belowLevels?: VolumeLevel[]
  currentPrice: number | null
  currentPriceTime?: string | null
  currentPriceTimestamp?: string | null
  totalVolume: number
  tradeCount: number
  bucket: number
  date: string
  status: string
  dataMode: string
  calculationMode: string
  dataQuality?: string | { status?: string; label?: string; reason?: string }
  quality?: string | { status?: string; label?: string; reason?: string }
  missingReason?: string
  /** Legacy fields are accepted but never substituted for ranked above/below levels. */
  hvtp: number | null
  hvtpVolume: number
  hvtpLevels: number[]
  signedGap: number | null
  pointGap: number | null
  gapPercent: number | null
  currentVsHvtp: number | null
  topLevels: VolumeLevel[]
}

export interface Overview {
  scanned?: number
  above?: number
  below?: number
  unchanged?: number
  largestGap?: number | null
  smallestGap?: number | null
  averageGap?: number | null
  withLevels?: number
  missing?: number
}

export interface ScannerResponse {
  rows: ScannerRow[]
  count?: number
  date?: string
  requestedDate?: string
  defaultDate?: string
  previousSessionDate?: string
  sessionStatus?: string
  dataMode?: string
  calculationMode?: string
  dataQuality?: string | { status?: string; state?: string; label?: string; reason?: string }
  analysisVersion?: string
  overview?: Overview
  rankings?: Record<string, ScannerRow[]>
}

export interface VolumeProfile extends ScannerRow {
  levels: VolumeLevel[]
  previousSessionDate: string
  priceSeries: PricePoint[]
}

export type SortField = 'pointGap' | 'gapPercent' | 'hvtpVolume' | 'symbol' | 'previousOpen' | 'hvtp' | 'signedGap' | 'currentPrice' | 'currentVsHvtp' | 'totalVolume' | 'aboveVolume' | 'belowVolume'
export interface ScannerFilters {
  date: string
  bucket: number
  topLevels: number
  sector: string
  query: string
  sort: SortField
  order: 'asc' | 'desc'
  direction: 'all' | 'above' | 'below'
  minVolume: number
  limit: '10' | '25' | '50' | 'all'
  liquidityThreshold: number
}

export interface PricePoint { time: string; price: number; volume?: number }
export interface LiveState { connected: boolean; updatedAt: Date | null; error: string | null }
export interface LiveUpdate extends ScannerResponse { profile?: VolumeProfile; sequence?: number; simulated?: boolean }
export interface Health { status?: string; defaultDate?: string; dataMode?: string; calculationMode?: string; provider?: string; lastUpdated?: string; sessionStatus?: string }
export interface MonitorResponse { status?: string; dataMode?: string; calculationMode?: string; provider?: string; lastUpdated?: string; lastCollection?: string; date?: string; instruments?: number; count?: number; message?: string; sessions?: unknown[]; [key: string]: unknown }
export interface HistoryEntry { date?: string; sessionDate?: string; symbol?: string; previousOpen?: number | null; aboveLevels?: VolumeLevel[]; belowLevels?: VolumeLevel[]; totalVolume?: number; status?: string; dataMode?: string; calculationMode?: string; [key: string]: unknown }
