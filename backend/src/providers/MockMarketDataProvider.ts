import type { MarketDataProvider, Stock, Trade } from '../types.js';
import { isTradingDay, previousSession } from '../services/calendar.js';

export const MOCK_DATE = '2025-01-15';
export { SAMPLE_HOLIDAYS } from '../services/calendar.js';
const LOT_SIZES: Record<string, number> = {
  RELIANCE: 250, HDFCBANK: 550, ICICIBANK: 700, INFY: 300, TCS: 175, SBIN: 750,
  BHARTIARTL: 475, ITC: 1600, KOTAKBANK: 400, LT: 150, AXISBANK: 625, MARUTI: 50,
  TATAMOTORS: 1425, SUNPHARMA: 350, ADANIENT: 300, HINDUNILVR: 300, WIPRO: 1500,
  BAJFINANCE: 125, HCLTECH: 350, ULTRACEMCO: 100, TITAN: 175, NTPC: 2250, ONGC: 2250, POWERGRID: 1900
};
const STOCK_DEFINITIONS: Array<[string, string, string, number]> = [
  ['RELIANCE', 'Reliance Industries', 'Energy', 1250], ['HDFCBANK', 'HDFC Bank', 'Financials', 1680],
  ['ICICIBANK', 'ICICI Bank', 'Financials', 1120], ['INFY', 'Infosys', 'Information Technology', 1540],
  ['TCS', 'Tata Consultancy Services', 'Information Technology', 4050], ['SBIN', 'State Bank of India', 'Financials', 760],
  ['BHARTIARTL', 'Bharti Airtel', 'Telecommunication', 1420], ['ITC', 'ITC', 'Consumer Staples', 465],
  ['KOTAKBANK', 'Kotak Mahindra Bank', 'Financials', 1810], ['LT', 'Larsen & Toubro', 'Industrials', 3550],
  ['AXISBANK', 'Axis Bank', 'Financials', 1090], ['MARUTI', 'Maruti Suzuki India', 'Automobile', 12600],
  ['TATAMOTORS', 'Tata Motors', 'Automobile', 780], ['SUNPHARMA', 'Sun Pharmaceutical', 'Healthcare', 1760],
  ['ADANIENT', 'Adani Enterprises', 'Metals & Mining', 2450], ['HINDUNILVR', 'Hindustan Unilever', 'Consumer Staples', 2320],
  ['WIPRO', 'Wipro', 'Information Technology', 520], ['BAJFINANCE', 'Bajaj Finance', 'Financials', 7350],
  ['HCLTECH', 'HCL Technologies', 'Information Technology', 1940], ['ULTRACEMCO', 'UltraTech Cement', 'Construction', 11200],
  ['TITAN', 'Titan Company', 'Consumer Durables', 3650], ['NTPC', 'NTPC', 'Power', 340],
  ['ONGC', 'Oil & Natural Gas Corporation', 'Energy', 270], ['POWERGRID', 'Power Grid Corporation', 'Power', 315]
];
const INDEX_DEFINITIONS: Array<[string, string, number]> = [
  ['NIFTY', 'NIFTY 50', 22500], ['BANKNIFTY', 'NIFTY Bank', 48000], ['FINNIFTY', 'NIFTY Financial Services', 21000],
  ['MIDCPNIFTY', 'NIFTY Midcap Select', 11000], ['NIFTYNXT50', 'NIFTY Next 50', 62000], ['NIFTYFPI150', 'Nifty India FPI 150', 18500]
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let value = hash(seed) || 1;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function tickPrice(paise: number): number { return Math.max(100, Math.round(paise / 5) * 5); }

/** Deterministic exchange-shaped data. It deliberately exposes every requested date as a
 * weekday session except the small configured holiday list, allowing the default date to move. */
export class MockMarketDataProvider implements MarketDataProvider {
  public readonly date: string;
  private readonly stocks: Stock[];
  constructor(date = MOCK_DATE) {
    this.date = date;
    const stocks = STOCK_DEFINITIONS.map(([symbol, name, sector, previousOpen]) => ({
      symbol, name, sector, previousOpen, exchange: 'NSE' as const, segment: 'FO' as const, instrumentType: 'EQUITY' as const,
      underlyingType: 'STOCK' as const, tickSize: 0.05, providerSymbol: symbol, lotSize: LOT_SIZES[symbol] ?? 1, isFno: true
    }));
    const indices = INDEX_DEFINITIONS.map(([symbol, name, previousOpen]) => ({
      symbol, name, sector: 'Indices', previousOpen, exchange: 'NSE' as const, segment: 'FO' as const, instrumentType: 'INDEX' as const,
      underlyingType: 'INDEX' as const, tickSize: 0.05, providerSymbol: symbol, lotSize: 1, isFno: true
    }));
    this.stocks = [...stocks, ...indices];
  }

  getInstrumentUniverse(): Stock[] { return this.getStocks(); }
  getStocks(): Stock[] { return this.stocks.map((stock) => ({ ...stock })); }

  getTrades(symbol: string, date = this.date): Trade[] {
    const stock = this.stocks.find((item) => item.symbol === symbol.toUpperCase());
    if (!stock || !this.isTradingDay(date)) return [];
    return this.generateTrades(stock, date, this.stocks.findIndex((item) => item.symbol === stock.symbol));
  }

  getHistoricalTrades(symbol: string, date = this.date): Trade[] { return this.getTrades(symbol, date); }
  getIntradayTrades(symbol: string, date = this.date): Trade[] { return this.getTrades(symbol, date); }

  getPreviousOpen(symbol: string, date = this.date): number | null {
    const stock = this.stocks.find((item) => item.symbol === symbol.toUpperCase());
    if (!stock || !this.isTradingDay(date)) return null;
    // Provider/API prices are rupees. The reference is the previous session's first
    // actual generated print, not the generator's internal paise-valued anchor.
    return this.generateTrades(stock, previousSession(date), this.stocks.indexOf(stock), 1)[0]?.price ?? null;
  }

  isTradingDay(date: string): boolean { return isTradingDay(date); }

  private generateTrades(stock: Stock, date: string, stockIndex: number, limit = MOCK_TRADES_PER_SYMBOL): Trade[] {
    const random = rng(`trades:${date}:${stock.symbol}`);
    // Preserve the deterministic baseline observations when fixing previous-open metadata.
    const openRandom = rng(`open:${previousSession(date)}:${stock.symbol}`);
    const open = tickPrice(Math.round((stock.previousOpen ?? 0) * 100) + Math.round((openRandom() - 0.5) * (stock.previousOpen ?? 1) * 7));
    const clusters = [-0.014, -0.005, 0.006, 0.014].map((offset) => Math.round(open * (1 + offset)));
    const trades: Trade[] = [];
    const start = new Date(`${date}T03:45:00.000Z`).getTime();
    const sessionSeconds = 6 * 60 * 60 + 15 * 60;
    const count = MOCK_TRADES_PER_SYMBOL;
    for (let i = 0; i < limit; i += 1) {
      const selector = random();
      const cluster = selector < 0.2 ? 0 : selector < 0.5 ? 1 : selector < 0.82 ? 2 : 3;
      const noise = Math.round((random() - 0.5) * Math.max(20, open * 0.0028));
      const pricePaise = tickPrice(clusters[cluster] + noise);
      const quantity = 25 + Math.floor(random() * 475) + (cluster === 2 ? 90 : cluster === 1 ? 45 : 0);
      const timestamp = new Date(start + Math.floor((i * sessionSeconds * 1000) / count)).toISOString();
      trades.push({ symbol: stock.symbol, tradeDate: date, timestamp, price: pricePaise / 100, quantity, side: (i + stockIndex) % 2 === 0 ? 'BUY' : 'SELL', source: 'baseline' });
    }
    return trades;
  }
}

export const MOCK_STOCK_COUNT = STOCK_DEFINITIONS.length;
export const MOCK_TRADES_PER_SYMBOL = 8640;
