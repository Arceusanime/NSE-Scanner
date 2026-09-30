import type { MarketDataProvider, Stock, Trade } from '../types.js';

/** Async-compatible boundary for exchange adapters. HTTP services can use this repository with
 * providers whose methods return either plain values or promises; the mock remains synchronous. */
export class ProviderRepository {
  constructor(private readonly provider: MarketDataProvider) {}
  stocks(): Promise<Stock[]> { return Promise.resolve(this.provider.getStocks()); }
  historicalTrades(symbol: string, date: string): Promise<Trade[]> {
    const method = this.provider.getHistoricalTrades ?? this.provider.getTrades;
    return Promise.resolve(method.call(this.provider, symbol, date));
  }
  intradayTrades(symbol: string, date: string): Promise<Trade[]> {
    const method = this.provider.getIntradayTrades ?? this.provider.getTrades;
    return Promise.resolve(method.call(this.provider, symbol, date));
  }
  previousOpen(symbol: string, date: string): Promise<number | null> { return Promise.resolve(this.provider.getPreviousOpen(symbol, date)); }
}
