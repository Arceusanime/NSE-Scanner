import type { Response } from 'express';
import type { Trade, ScannerEnvelope, ScannerQuery, VolumeProfile } from '../types.js';
import type { MarketService } from './marketService.js';
import { sessionEnd } from './calendar.js';

interface LiveOptions extends ScannerQuery { symbol?: string; }
interface Client { id: number; response: Response; options: LiveOptions; }
interface SessionFeed {
  date: string;
  sequence: number;
  lastTickAt?: number;
  timer?: ReturnType<typeof setInterval>;
  clients: Map<number, Client>;
}

/** One replay clock per resolved date, shared by SSE clients and finite polling.
 * Sequence state survives disconnects; timers exist only while a stream is connected. */
export class LiveSessionEngine {
  private readonly feeds = new Map<string, SessionFeed>();
  private nextClientId = 1;
  constructor(private readonly service: MarketService) {}

  private feed(date: string): SessionFeed {
    let feed = this.feeds.get(date);
    if (!feed) {
      feed = { date, sequence: 0, clients: new Map() };
      this.feeds.set(date, feed);
    }
    return feed;
  }

  snapshot(options: LiveOptions): ScannerEnvelope & { profile?: VolumeProfile; simulated: true; sequence: number } {
    const scanner = this.service.scanner(options);
    const profile = options.symbol ? this.service.profile(options.symbol, scanner.requestedDate, options.bucket, options.topLevels) ?? undefined : undefined;
    return { ...scanner, ...(profile ? { profile } : {}), simulated: true, sequence: this.feeds.get(scanner.date)?.sequence ?? 0 };
  }

  poll(options: LiveOptions): ReturnType<LiveSessionEngine['snapshot']> {
    const resolved = this.service.resolveDate(options.date);
    const feed = this.feed(resolved.date);
    // Active SSE owns the clock. Several polling clients must not multiply trade volume.
    if (!feed.clients.size && (feed.lastTickAt === undefined || Date.now() - feed.lastTickAt >= 2000)) this.advance(feed);
    return this.snapshot({ ...options, date: options.date ?? resolved.date });
  }

  subscribe(options: LiveOptions, response: Response): string {
    const resolved = this.service.resolveDate(options.date);
    const pinnedOptions = { ...options, date: options.date ?? resolved.date };
    // Resolve/calculations can fail. Do them before sending SSE headers or allocating a timer.
    const initial = this.snapshot(pinnedOptions);
    const feed = this.feed(resolved.date);
    const id = this.nextClientId++;
    feed.clients.set(id, { id, response, options: pinnedOptions });
    if (!feed.timer) feed.timer = setInterval(() => this.tick(feed.date), 2000);
    try {
      response.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.flushHeaders();
      response.write(`event: update\ndata: ${JSON.stringify(initial)}\n\n`);
    } catch (error) {
      this.unsubscribe(`${feed.date}:${id}`);
      throw error;
    }
    return `${feed.date}:${id}`;
  }

  unsubscribe(key: string): void {
    const separator = key.lastIndexOf(':'); const date = key.slice(0, separator); const id = Number(key.slice(separator + 1));
    const feed = this.feeds.get(date); if (!feed) return;
    feed.clients.delete(id);
    if (!feed.clients.size && feed.timer) { clearInterval(feed.timer); feed.timer = undefined; }
  }

  private advance(feed: SessionFeed): void {
    const trades: Trade[] = [];
    for (const stock of this.service.listStocks()) {
      const previous = this.service.getLatestTrade(stock.symbol, feed.date);
      if (!previous) continue;
      const timestamp = new Date(Math.max(sessionEnd(feed.date) + feed.sequence * 2000, Date.parse(previous.timestamp) + 1)).toISOString();
      const basePaise = Math.round(previous.price * 100);
      const shift = ((feed.sequence + stock.symbol.length) % 3 - 1) * 5;
      trades.push({ symbol: stock.symbol, tradeDate: feed.date, timestamp, price: Math.max(5, basePaise + shift) / 100, quantity: 25 + ((feed.sequence * 17 + stock.symbol.length * 11) % 100), side: feed.sequence % 2 ? 'BUY' : 'SELL', source: 'simulated' });
    }
    if (trades.length) this.service.appendSimulatedTrades(trades);
    feed.sequence += 1;
    feed.lastTickAt = Date.now();
  }

  private tick(date: string): void {
    const feed = this.feeds.get(date); if (!feed || !feed.clients.size) return;
    try {
      this.advance(feed);
      for (const client of feed.clients.values()) {
        if (client.response.writableEnded || client.response.destroyed) { this.unsubscribe(`${date}:${client.id}`); continue; }
        try { client.response.write(`event: update\ndata: ${JSON.stringify(this.snapshot(client.options))}\n\n`); }
        catch { this.unsubscribe(`${date}:${client.id}`); client.response.end(); }
      }
    } catch (error) {
      // Timer callbacks are outside Express's error boundary. Close streams so clients can
      // reconnect/fall back rather than letting a storage failure crash the process.
      console.error('Simulated live update failed', error);
      for (const client of [...feed.clients.values()]) {
        this.unsubscribe(`${date}:${client.id}`);
        client.response.end();
      }
    }
  }

  close(): void {
    for (const feed of this.feeds.values()) {
      if (feed.timer) clearInterval(feed.timer);
      for (const client of feed.clients.values()) client.response.end();
    }
    this.feeds.clear();
  }
}
