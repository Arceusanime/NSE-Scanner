import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Works both from backend/src and the compiled backend/dist/src tree, regardless of cwd.
let directory = dirname(fileURLToPath(import.meta.url));
while (!existsSync(resolve(directory, 'package.json')) && dirname(directory) !== directory) directory = dirname(directory);
export const BACKEND_ROOT = directory;
export const PROJECT_ROOT = resolve(BACKEND_ROOT, '..');
config({ path: resolve(PROJECT_ROOT, '.env') });
config({ path: resolve(BACKEND_ROOT, '.env') });
const configuredPath = process.env.DATABASE_PATH ?? process.env.DB_PATH ?? 'data/scanner.sqlite';
export const DEFAULT_DATABASE_PATH = configuredPath === ':memory:' ? configuredPath : resolve(BACKEND_ROOT, configuredPath);
/** `mock` is deliberately the no-credential local default. Real mode requires a configured server-side URL. */
export const MARKET_DATA_MODE = process.env.MARKET_DATA_MODE === 'real' ? 'real' : 'mock';
export const MARKET_DATA_URL = process.env.MARKET_DATA_URL;
export const MARKET_DATA_API_KEY = process.env.MARKET_DATA_API_KEY;
