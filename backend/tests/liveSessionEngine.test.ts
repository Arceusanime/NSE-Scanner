import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppContext } from '../src/app.js';
import { createDatabase } from '../src/database/database.js';
import { fixtureProvider, TEST_DATE } from './helpers.js';
import type { ScannerEnvelope, VolumeProfile } from '../src/types.js';

type Update = ScannerEnvelope & { sequence: number; simulated: boolean; profile?: VolumeProfile };
function response() {
  const updates: Update[] = [];
  const client = {
    writableEnded: false, destroyed: false,
    status: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { updates.push(JSON.parse(chunk.split('data: ')[1]) as Update); return true; }),
    end: vi.fn()
  };
  return { client: client as unknown as Response, updates };
}

describe('simulated live session engine', () => {
  let context: AppContext;
  const setup = () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
    context = createApp({ db: createDatabase(':memory:'), provider: fixtureProvider(), defaultDate: TEST_DATE });
    return context;
  };
  afterEach(() => { context?.live.close(); context?.db.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('shares one two-second clock across clients and preserves per-client scanner filters', () => {
    const { live, service } = setup();
    const first = response(); const second = response();
    const key1 = live.subscribe({ symbol: 'ABOVE', direction: 'above', bucket: 5 }, first.client);
    const key2 = live.subscribe({ symbol: 'BELOW', direction: 'below', bucket: 1 }, second.client);
    expect(vi.getTimerCount()).toBe(1);
    expect(first.updates[0]).toMatchObject({ simulated: true, sequence: 0, count: 1 });
    vi.advanceTimersByTime(1999);
    expect(first.updates).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(first.updates).toHaveLength(2);
    expect(first.updates.at(-1)).toMatchObject({ sequence: 1, count: 1 });
    expect(second.updates.at(-1)).toMatchObject({ sequence: 1, count: 1 });
    expect(service.getTrades('ABOVE').filter((trade) => trade.source === 'simulated')).toHaveLength(1);
    expect(first.updates[1].profile?.currentPrice).toBe(first.updates[1].rows[0].currentPrice);
    const third = response();
    const key3 = live.subscribe({ symbol: 'ABOVE' }, third.client);
    expect(third.updates[0].sequence).toBe(1);
    live.unsubscribe(key1); live.unsubscribe(key2); live.unsubscribe(key3);
    expect(vi.getTimerCount()).toBe(0);
    const reconnect = response();
    const reconnectKey = live.subscribe({}, reconnect.client);
    expect(reconnect.updates[0].sequence).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(reconnect.updates[1].sequence).toBe(2);
    live.unsubscribe(reconnectKey);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('advances standalone polling at most once per two seconds and shares SSE sequence/state', () => {
    const { live, service } = setup();
    const first = live.poll({ symbol: 'ABOVE' });
    expect(first.sequence).toBe(1);
    expect(live.poll({ symbol: 'BELOW' }).sequence).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(live.poll({ symbol: 'ABOVE' }).sequence).toBe(2);
    const client = response();
    live.subscribe({}, client.client);
    expect(client.updates[0].sequence).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(live.poll({}).sequence).toBe(3);
    expect(client.updates.at(-1)?.sequence).toBe(3);
    const simulated = service.getTrades('ABOVE').filter((trade) => trade.source === 'simulated');
    expect(simulated).toHaveLength(3);
    expect(new Set(simulated.map((trade) => trade.timestamp)).size).toBe(3);
    expect(service.profile('ABOVE')?.currentPrice).toBe(simulated.at(-1)?.price);
  });

  it('shares weekend requests by resolved session and never invents holiday observations', () => {
    const { live, service } = setup();
    const weekend = response(); const weekday = response(); const holiday = response();
    live.subscribe({ date: '2025-01-19', symbol: 'ABOVE' }, weekend.client);
    live.subscribe({ date: '2025-01-17', symbol: 'ABOVE' }, weekday.client);
    live.subscribe({ date: '2025-08-15', symbol: 'ABOVE' }, holiday.client);
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(weekend.updates[1]).toMatchObject({ date: '2025-01-17', requestedDate: '2025-01-19', sequence: 1 });
    expect(weekday.updates[1].profile).toMatchObject({ tradeCount: 3 });
    expect(holiday.updates[1]).toMatchObject({ sessionStatus: 'No trading session', rows: [], profile: { tradeCount: 0 } });
    expect(service.getTrades('ABOVE', '2025-08-15')).toEqual([]);
  });

  it('validates before sending stream headers or allocating timers', () => {
    const { live } = setup();
    const client = response();
    expect(() => live.subscribe({ date: '2025-02-30' }, client.client)).toThrow();
    expect(client.client.flushHeaders).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes streams instead of crashing on an interval storage error', () => {
    const { live, service } = setup();
    const client = response();
    live.subscribe({}, client.client);
    vi.spyOn(service, 'appendSimulatedTrades').mockImplementation(() => { throw new Error('storage failure'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(client.client.end).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
