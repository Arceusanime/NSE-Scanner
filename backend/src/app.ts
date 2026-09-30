import cors from 'cors';
import express, { type Express } from 'express';
import type { MarketDataProvider } from './types.js';
import { createDatabase, seedDatabase, type SqliteDatabase } from './database/database.js';
import { MockMarketDataProvider } from './providers/MockMarketDataProvider.js';
import { MarketService } from './services/marketService.js';
import { LiveSessionEngine } from './services/liveSessionEngine.js';
import { createApiRouter } from './routes/api.js';

export interface AppContext { app: Express; db: SqliteDatabase; service: MarketService; live: LiveSessionEngine; }

export function createApp(options: { db?: SqliteDatabase; provider?: MarketDataProvider; defaultDate?: string } = {}): AppContext {
  const provider = options.provider ?? new MockMarketDataProvider();
  const db = options.db ?? createDatabase();
  seedDatabase(db, provider);
  const service = new MarketService(db, provider, options.defaultDate);
  const live = new LiveSessionEngine(service);
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json());
  app.use('/api', createApiRouter(service, live));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (res.headersSent) return _next(error);
    const badRequest = /must be|invalid|unknown query|unsupported|positive|non-negative/i.test(message);
    if (!badRequest) console.error(error);
    res.status(badRequest ? 400 : 500).json({ error: badRequest ? message : 'Internal server error' });
  });
  return { app, db, service, live };
}
