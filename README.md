# NSE F&O previous-open volume-level analyzer (V1)

A local, read-only V1 analyzer for representative NSE F&O underlying equities. For each selected session it compares the **previous trading session's open** with up to three highest-volume price levels strictly above and strictly below that open. The backend performs session resolution, exact trade-level bucketing, quality-state labeling, filtering, sorting, and ranking; the React/Vite frontend only presents backend responses. A legacy HVTP field may remain for compatibility, but a single HVTP ranking is not the V1 product output.

This repository is deliberately a working **mock-data prototype**, not an NSE feed or a trading system. The generated universe, lot sizes, calendar, prices, and trades are representative and have not been verified against the current NSE contract master. `calculationMode: "exact"` means exact aggregation of supplied mock trade rows, not complete or exchange-certified data. The application places no orders and is not investment advice.

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the service/API contract, [`DATA_PIPELINE.md`](./DATA_PIPELINE.md) for the data flow/schema/quality states/daily workflow, and [`PROVIDER_INTEGRATION.md`](./PROVIDER_INTEGRATION.md) before attempting a real data source.

## Quick start

Requirements:

- Node.js **22.12 or newer**
- npm compatible with that Node release

No environment file is required for the default local run:

```bash
npm install
npm run dev
```

The root `dev` command starts both workspaces:

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:3001>

To customize local ports or paths, copy `.env.example` to `.env` and edit it. The backend and Vite both read this root file. `PORT` selects the API port, `FRONTEND_PORT` selects the Vite port, and Vite's `/api` proxy follows the backend `HOST`/`PORT`. Update `CORS_ORIGIN` too when using a different browser origin. Relative `DB_PATH` values are resolved from `backend/`. All variables are optional; the defaults above work without a `.env` file. Never put provider credentials or other secrets in a `VITE_*` variable: Vite exposes those values to the browser bundle.

## Root commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the backend and Vite frontend together |
| `npm run dev:backend` | Start only the Express API |
| `npm run dev:frontend` | Start only the Vite UI |
| `npm run build` | Build both workspaces |
| `npm test` | Run backend and frontend regression tests |
| `npm run test:backend` | Run backend tests |
| `npm run test:frontend` | Run frontend tests |
| `npm run typecheck` | Type-check workspaces that expose that script |

After building, `npm start --workspace backend` runs the compiled API. Serve `frontend/dist/` with a web server that proxies `/api` to the backend (or build with an appropriate `VITE_API_URL`); the backend does not serve frontend assets.

The workspace uses SQLite for local persistence. Database files, build output, `.env`, and other runtime artifacts are ignored by Git.

## What V1 calculates

For a selected session date, each row compares:

- `previousOpen`/`previousDayOpen`: the opening print from the immediately preceding resolved trading session;
- `aboveLevels`: up to three highest-volume bucket levels strictly above that open; and
- `belowLevels`: up to three highest-volume bucket levels strictly below that open.

Each side is ordered by quantity descending, then distance from the previous open, then price. A level equal to the open is excluded from both sides. The complete bucket profile remains available for inspection where supported. Compatibility `hvtp`, gap, and ranking fields may still appear for older clients, but they are not the V1 product output.

The profile is built from every persisted trade for the selected symbol and date. It is **exact relative to those trade records**: quantity is grouped at the observed execution price after applying the requested bucket. It is not an OHLCV reconstruction. The prototype has no value area, POC, VAL, VAH, candle approximation, or inferred distribution calculation.

The supported bucket widths are `.05`, `1`, `5`, and `10` rupees. Prices are converted to integer paise and each trade is assigned to the nearest bucket boundary, avoiding floating-point bin drift. `status` separately describes data availability (`ok`, `No trade data available`, `Previous open unavailable`, `Low liquidity`, or `No trading session`).

## Dates, sessions, and mock data

Dates are interpreted in India Standard Time. If a requested date is a weekend, it resolves backward to a preceding weekday. Explicitly configured sample holidays produce `No trading session` rather than fabricated trades. The holiday calendar is a curated 2025–2026 sample only and is not a complete NSE holiday calendar. Responses expose both the requested and resolved dates, the previous session date, and session status so callers can see what was used.

The default health response exposes `defaultDate`, the previous trading day in IST. Omitting `date` uses that date. A profile's selected day is the resolved profile date; its `previousDayOpen` is always looked up from the session immediately before that day, not from the selected session's open.

The mock provider generates 24 representative F&O underlying equity symbols and 8,640 deterministic baseline trade records per symbol/date. The baseline seed is derived from symbol and date, so baseline generation is reproducible. Simulated-live trades are persisted separately in the same SQLite database and are included in subsequent reads, including after live mode is switched off. Symbols, constituents, contract metadata, and lot sizes are suitable for UI and API development only; they are not a verified live market universe.

Successful data responses identify the current source and calculation modes:

```json
{
  "dataMode": "mock",
  "calculationMode": "exact"
}
```

`exact` means exact grouping of the trades supplied by the mock provider. It does not mean live, complete, or exchange-certified data.

## API at a glance

All routes are under `/api`. JSON errors use an HTTP error status and an `error` message. Invalid dates, enum values, symbols, and numeric filters should be treated as client errors; an unknown symbol is not silently substituted.

### `GET /api/health`

Returns readiness and the current session defaults, including `defaultDate` (previous trading day in IST), `dataMode`, and `calculationMode`.

### `GET /api/scanner`

Returns the scanner envelope described in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Supported query parameters are:

| Parameter | Values/default | Meaning |
| --- | --- | --- |
| `date` | `YYYY-MM-DD`; default `defaultDate` | Requested selected session; weekends resolve backward; sample holidays can have no session |
| `bucket` | `.05`, `1`, `5`, `10`; default `1` | Rupee bucket width |
| `topLevels` | `1`, `3`, `5`, `10`; default `3` | Compatibility cap for embedded levels; V1 returns up to three strict levels per side |
| `sort` | `pointGap`, `hvtpVolume`, `gapPercent`, `symbol`, `previousOpen`, `hvtp`, `signedGap`, `currentPrice`, `currentVsHvtp` | Compatibility/order field; V1 consumers should use backend-selected above/below levels |
| `order` | `asc`, `desc`; default `desc` | Sort direction |
| `direction` | `all`, `above`, `below`; default `all` | Strict previous-open side filter |
| `minVolume` | non-negative quantity | Compatibility minimum **HVTP quantity**; not the V1 level-selection rule |
| `limit` | `10`, `25`, `50`, `all`; default `all` | Number of returned rows |
| `sector` | sector name | Exact sector filter |
| `query` | text | Symbol/name search |
| `liquidityThreshold` | quantity; default `100000` | Minimum total session quantity for scanner rows; separate from `minVolume` |

The response includes `rows`, `count`, resolved `date`, `requestedDate`, `previousSessionDate`, `defaultDate`, `sessionStatus`, source/calculation modes, strict `aboveLevels`/`belowLevels` (up to three per side), an `overview`, and three precomputed `rankings` lists. Compatibility gap/HVTP fields may be present for older clients but are not the V1 product ranking. Overview/rankings cover the whole selected-session universe before scanner filters or limits, not just the visible rows.

### Other read-only routes

- `GET /api/stocks` — the 24-symbol mock universe and metadata such as sector, F&O flag, and representative lot size.
- `GET /api/stocks/:symbol` — metadata and the symbol's selected-date summary/profile view.
- `GET /api/trades/:symbol` — exact normalized mock trades for the requested/resolved date, with optional pagination supported by the backend.
- `GET /api/market/previous-open/:symbol` — the previous-session open used for the symbol/date comparison.
- `GET /api/volume-profile/:symbol` — the selected symbol's previous-open comparison, strict `aboveLevels`/`belowLevels` (up to three each), complete bucket levels where supported, price series, selected/previous session dates, name, and sector; compatibility HVTP fields may remain.
- `GET /api/live` — a finite polling step. When no SSE clients are connected for that date, polling advances the simulation at most once every two seconds; polling and SSE share a clock so extra clients do not multiply trade volume.
- `GET /api/live/stream` — a continuous server-sent event stream. It emits an `update` event every two seconds with the scanner envelope and, when requested, an optional profile. Updates are marked `simulated: true` and carry a monotonic `sequence`; they are not live exchange quotes.

The frontend uses `/api` by default and can be pointed at another backend with `VITE_API_URL` (include `/api` in that base URL). The stream uses EventSource automatic reconnection, not a polling fallback.

## Architecture and development boundaries

- `backend/` owns Express routes, date/session resolution, SQLite persistence and caches, mock trade generation, exact trade aggregation, strict above/below selection, scanner filters, rankings, and simulated live updates.
- `frontend/` owns presentation, navigation, charts, filters, and the SSE client. It does not recompute levels, gaps, profiles, or session dates.
- The root workspace owns scripts and local configuration. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the complete contract and extension notes.
- [`DATA_PIPELINE.md`](./DATA_PIPELINE.md) is the operational source of truth for flow, schema, quality states, and daily use.
- [`PROVIDER_INTEGRATION.md`](./PROVIDER_INTEGRATION.md) defines the provider boundary and explains why OHLCV/delayed/partial data cannot be labeled exact.

A real provider would need an authoritative exchange calendar and symbol/contract master, licensed authenticated access, execution-level coverage, rate limiting, corrections, retries, deduplication, completeness checks, and secure server-side credential handling. No such provider or credential flow is included.

## Daily workflow, deployment, and security

Daily local use is intentionally explicit: start `npm run dev`, check `/api/health`, select a date, verify the resolved session and previous open, inspect the strict above/below levels, and treat every quality state as meaningful metadata. Use simulated live only to exercise the UI/SSE path. See [`DATA_PIPELINE.md`](./DATA_PIPELINE.md) for the full workflow and reset procedure.

For a single instance, build with `npm run build`, run `npm start --workspace backend`, serve `frontend/dist/` from a web server, and proxy `/api` plus `/api/live/stream` to the backend (with SSE buffering disabled). Keep SQLite on a persistent protected volume. The in-process stream and SQLite file are not horizontal-scale infrastructure.

The backend defaults to `127.0.0.1` and has no authentication or authorization. Before exposing it to other users, add an authenticated TLS reverse proxy, restrictive CORS, request limits, logging/auditing, protected backups, and secret rotation. Never place provider credentials in `VITE_*`; those values are embedded in browser assets. CORS is not authentication.

## Limitations and disclaimer

This application is descriptive software over deterministic mock observations. Missing or low-liquidity sessions can produce empty/partial profiles and status flags rather than meaningful market conclusions. Sample holiday handling, representative constituents, lot sizes, timestamps, and generated prices must all be replaced or validated before production use. Compatibility HVTP fields do not make the product a market signal. SQLite and the in-process live stream are appropriate for one local prototype, not guaranteed delivery or horizontal scaling. Do not use this prototype to place trades or make investment decisions.
