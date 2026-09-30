import type { MarketDataProvider, Stock, Trade } from '../src/types.js';

export const TEST_DATE = '2025-01-15';
export const fixtureStock = (symbol: string, sector = 'Energy'): Stock => ({
  symbol, name: `${symbol} Company`, exchange: 'NSE', sector, instrumentType: 'EQUITY', lotSize: 1, isFno: true
});
export const fixtureTrade = (symbol: string, price: number, quantity: number, index = 0): Trade => ({
  symbol, tradeDate: TEST_DATE, timestamp: new Date(Date.parse(`${TEST_DATE}T03:45:00Z`) + index * 1000).toISOString(),
  price, quantity, side: 'BUY', source: 'baseline'
});
export function fixtureProvider(): MarketDataProvider {
  const stocks = [fixtureStock('ABOVE'), fixtureStock('BELOW', 'Financials'), fixtureStock('MISSING'), fixtureStock('EMPTY'), fixtureStock('LOW')];
  const trades: Record<string, Trade[]> = {
    ABOVE: [fixtureTrade('ABOVE', 105, 200000), fixtureTrade('ABOVE', 110, 100000, 1)],
    BELOW: [fixtureTrade('BELOW', 90, 300000)],
    MISSING: [fixtureTrade('MISSING', 500, 200000)], EMPTY: [], LOW: [fixtureTrade('LOW', 100, 10)]
  };
  return {
    getStocks: () => stocks,
    getTrades: (symbol, date) => (trades[symbol.toUpperCase()] ?? []).map((trade) => ({ ...trade, tradeDate: date, timestamp: trade.timestamp.replace(TEST_DATE, date) })),
    getPreviousOpen: (symbol) => symbol === 'MISSING' ? null : 100
  };
}
