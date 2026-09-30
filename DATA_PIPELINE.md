# V1 data pipeline

This document describes the implemented read-only previous-open volume-level analyzer. The backend owns session resolution, provider ingestion, persistence, aggregation, quality states, and scanner ordering. The frontend renders backend responses; it does not recalculate gaps or volume profiles.

## Product invariant

For a selected session `D`, every instrument compares the open from the immediately preceding resolved trading session with the selected session's executed quantity distribution:

- `previousOpen` is the previous session's opening print;
- `aboveLevels` contains up to three highest-volume price levels strictly above `previousOpen`;
- `belowLevels` contains up to three highest-volume price levels strictly below `previousOpen`; and
- each level retains its price, aggregated quantity, trade count, and share of session quantity.

The V1 product is analytical and read-only. Its primary result is the previous open plus the bounded above/below volume levels—not a single HVTP ranking. A legacy/compatibility HVTP field may be retained by an API response while clients migrate, but it is not the V1 product output. The product deliberately does not calculate POC/VAL/VAH, value area, or an execution distribution inferred from candles.

## End-to-end flow

```text
HTTP/SSE request
      |
      v
validate date and query -> resolve IST session (weekend fallback / holiday state)
      |
      v
provider boundary -> normalized trades + previous-session open + instrument metadata
      |
      v
SQLite materialization (idempotent baseline; simulated rows are append-only)
      |
      v
integer-paise bucket aggregation -> levels, totals, trade counts, side quantities
      |
      v
strict above/below selection (max three per side) -> quality state
      |
      v
scanner filters/rankings or profile DTO -> React/Vite UI
```

### Request and session resolution

1. Dates are validated as real `YYYY-MM-DD` values in the supported range and interpreted using Asia/Kolkata session semantics.
2. An omitted date uses the previous trading day relative to the server clock (`defaultDate`). A weekend request resolves backward to the preceding weekday. A configured sample holiday remains explicitly unavailable as `No trading session`; it is not filled with fabricated trades.
3. The response retains both `requestedDate` and resolved `date`, plus `previousSessionDate` and `sessionStatus`.
4. A selected session is materialized lazily per symbol. Repeated requests reuse the `session_opens` completion marker and do not duplicate baseline trades.

The bundled calendar is only a small sample of holidays for the mock fixture. It is not an authoritative NSE calendar and must be replaced by a validated exchange calendar before production use.

### Provider normalization and materialization

The current provider is `MockMarketDataProvider`. It returns a 24-symbol representative universe and 8,640 deterministic baseline observations per symbol/session. The generated data is reproducible from symbol and date, but it is not an NSE feed.

A normalized trade contains:

| Field | Meaning |
| --- | --- |
| `symbol` | Provider instrument identifier, normalized to the application universe |
| `tradeDate` | Resolved selected session |
| `timestamp` | ISO timestamp for ordering; session timezone must be normalized before aggregation |
| `price` | Positive execution price in rupees at the provider boundary; stored as integer paise |
| `quantity` | Positive integer executed quantity |
| `side` | `BUY` or `SELL` when supplied by the source |
| `source` | `baseline` for materialized provider data or `simulated` for the local live fixture |

The previous open is stored separately by symbol/session. It is not silently substituted with the selected session's open. Missing trade rows or missing opens remain visible through quality states.

### Persistence and aggregation

SQLite uses WAL mode for local durability. Baseline materialization is transactional and idempotent. Prices are stored as integer paise and quantities as integers. The aggregate profile is calculated on demand from stored trades; no persisted aggregate can become stale relative to its source rows.

For bucket width `B` rupees:

```text
bucketPaise = round(B × 100)
levelPaise = round(pricePaise / bucketPaise) × bucketPaise
levelPrice = levelPaise / 100
```

Supported widths are `0.05`, `1`, `5`, and `10` rupees. This is nearest-boundary assignment using integer paise, not a floor bin and not a candle allocation. Each level contains total quantity (`volume`), trade count, buy/sell quantities, and percentage of selected-session quantity. The profile route returns every level; scanner rows include the requested top levels.

Level selection is deterministic:

1. aggregate quantity by bucket;
2. split levels using strict price comparisons with `previousOpen` (the open itself belongs to neither side);
3. sort each side by quantity descending, then distance from `previousOpen` ascending, then price ascending; and
4. retain at most three levels per side for the V1 result. Ties therefore do not depend on database row order.

The complete bucket profile may remain available for inspection, but scanner/dashboard rankings are based on the selected above/below levels and their quality state, not on a single HVTP. `currentPrice` is the last stored selected-session print, not a guaranteed live quote. Simulated live rows are appended to SQLite and can change later profile reads; they are explicitly synthetic.

## Data model

The active schema is intentionally small:

| Table | Key columns | Role |
| --- | --- | --- |
| `stocks` | `symbol` PK, `name`, `exchange`, `sector`, `instrument_type`, `lot_size`, `is_fno`, `previous_open` | Instrument metadata and illustrative mock reference metadata. The session-specific open lives in `session_opens`. |
| `trading_sessions` | `trading_date` unique, `previous_session_date`, `session_status` | One session-level resolution/completion record. |
| `session_opens` | `(symbol, trading_date)` PK, `previous_open` | Per-symbol previous-session open in integer paise; a row also acts as the idempotent baseline completion marker, including for empty/missing-open feeds. |
| `trades` | `id` PK, `symbol`, `trade_date`, `timestamp`, `price`, `quantity`, `side`, `source` | Source observations. `price` is integer paise; `source` is `baseline` or `simulated`. Indexed by symbol/session/source/time/id. |

There is no active `volume_at_price` aggregate table. Older scaffold tables can be renamed to `legacy_*` during migration and are not used as exact V1 observations. Deleting the local database regenerates the mock universe and newly requested sessions.

## Quality states and truth labels

Every successful data envelope includes:

- `dataMode: "mock"`: observations come from the bundled deterministic mock provider;
- `calculationMode: "exact"`: quantities were grouped from the supplied normalized trade rows, without OHLCV allocation; and
- a session/profile `status` where applicable.

`exact` is relative to the rows received. It does **not** mean complete, real-time, exchange-certified, or historically complete market data. The current implementation does not expose a real-provider or estimated mode; a future adapter must change the labels rather than reuse `exact` when it cannot supply execution-level observations.

| State | Meaning | Display/API behavior |
| --- | --- | --- |
| `ok` | Selected-session trades and previous open are available. | Gaps and HVTP are calculable. |
| `No trade data available` | Session is valid but no selected-session trades were materialized. | Profile levels and derived metrics are empty/null. |
| `Previous open unavailable` | Trades exist but the preceding-session open is missing. | Levels remain available; comparison fields are null. |
| `Low liquidity` | Scanner row's selected-session total quantity is below `liquidityThreshold` (default `100000`). | The row remains visible only when it meets the scanner filter; it is not silently treated as healthy. |
| `No trading session` | Requested date is a configured sample holiday. | No trades are fabricated and comparison values are unavailable. |

A status is not a trading signal. `above`, `below`, and `unchanged` are derived independently from the sign of `signedGap` when that metric exists.

## API consumers

All routes are under `/api` and return source/calculation labels:

- `GET /health` — readiness, `defaultDate`, and current data/calculation modes;
- `GET /scanner` — filtered/sorted rows, overview, and whole-universe rankings;
- `GET /volume-profile/:symbol` — previous-open comparison, selected above/below levels, complete bucketed profile (where enabled), and price series;
- `GET /trades/:symbol` — normalized source rows with optional pagination;
- `GET /market/previous-open/:symbol` — selected date context and the reference open;
- `GET /stocks` and `GET /stocks/:symbol` — universe metadata and profile; and
- `GET /live` / `GET /live/stream` — a local synthetic update clock, marked `simulated: true`.

The SSE stream is an in-process simulation, not exchange streaming. Its sequence is not durable across process restarts and it does not provide replay or guaranteed delivery.

## Daily local workflow

1. Start the workspace with `npm run dev` and check `GET /api/health`.
2. Select a date in the scanner. Confirm the UI shows the resolved date, previous session, source (`MOCK`), and calculation state (`Exact` relative to mock trades).
3. Use the scanner for backend-sorted gaps and filters, then open a profile to inspect all levels, tied HVTP levels, and the price series.
4. Treat weekends, sample holidays, no-trade sessions, missing opens, and low liquidity as quality states—not as missing values to hide.
5. Use “simulated live” only to exercise the SSE/UI path. It appends synthetic observations and must not be read as live market data.
6. For a repeatable reset, stop the backend and remove the configured SQLite file plus its `-wal`/`-shm` files, then restart. Do not delete a shared production database casually.

For a real provider, run an explicit ingestion/backfill job before analysis, persist source coverage and corrections, and keep the same quality-state contract. See [`PROVIDER_INTEGRATION.md`](./PROVIDER_INTEGRATION.md).

## Verification invariants

Changes to the pipeline should preserve deterministic symbol/date generation, integer-paise nearest buckets, exact quantity totals, strict exclusion of the previous-open level, at most three deterministic above and below levels, previous-session lookup, empty/low-liquidity statuses, and synthetic SSE cadence. Compatibility fields must not turn a single HVTP into the primary V1 ranking. Passing tests only establishes implementation behavior; it does not validate the mock data against NSE.
