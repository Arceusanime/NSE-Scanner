import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const { app, db, live } = createApp();
const server = app.listen(port, host, () => console.log(`NSE volume scanner API listening on http://${host}:${port} (mock/exact)`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    live.close();
    server.close(() => db.close());
  });
}
