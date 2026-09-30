import type { MarketDataProvider, Stock, Trade } from '../types.js';

/**
 * Honest real-data boundary. The application never silently falls back to mock data:
 * without an explicitly configured endpoint this adapter reports unavailable data. A
 * deployment can point it at a small server-side normalizer exposing stocks/trades/open
 * resources; provider credentials are intentionally not accepted by the browser.
 */
export class RealMarketDataProvider implements MarketDataProvider {
  readonly dataMode = 'real' as const;
  readonly calculationMode = 'exact' as const;
  readonly name = 'real-provider-scaffold';
  private readonly endpoint?: string;
  private readonly apiKey?: string;

  constructor(options: { endpoint?: string; apiKey?: string } = {}) {
    this.endpoint = options.endpoint?.replace(/\/$/, '');
    this.apiKey = options.apiKey;
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.endpoint) throw new Error('Real market provider is not configured; set MARKET_DATA_URL or use mock mode');
    const response = await fetch(`${this.endpoint}${path}`, { headers: { Accept: 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) } });
    if (!response.ok) throw new Error(`Real market provider returned HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  async getStocks(): Promise<Stock[]> {
    const payload = await this.request<Stock[] | { stocks?: Stock[] }>('/stocks');
    return Array.isArray(payload) ? payload : payload.stocks ?? [];
  }
  async getTrades(symbol: string, date: string): Promise<Trade[]> {
    const payload = await this.request<Trade[] | { trades?: Trade[] }>(`/trades/${encodeURIComponent(symbol)}?date=${encodeURIComponent(date)}`);
    return Array.isArray(payload) ? payload : payload.trades ?? [];
  }
  getHistoricalTrades(symbol: string, date: string): Promise<Trade[]> { return this.getTrades(symbol, date); }
  getIntradayTrades(symbol: string, date: string): Promise<Trade[]> { return this.getTrades(symbol, date); }
  async getPreviousOpen(symbol: string, date: string): Promise<number | null> {
    const payload = await this.request<{ previousOpen?: number | null }>(`/previous-open/${encodeURIComponent(symbol)}?date=${encodeURIComponent(date)}`);
    return payload.previousOpen ?? null;
  }
}
