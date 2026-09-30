# Provider integration and data truth

V1 ships with one provider: `MockMarketDataProvider`. There is no bundled NSE adapter, exchange credential, broker connection, or claim of live/historical exchange coverage. This document is the contract for adding a provider without overstating data quality.

## Current state

The provider boundary supplies:

- a stock/instrument universe (`getStocks`);
- selected-session execution rows (`getTrades`, or the optional `getHistoricalTrades` alias);
- selected-session/intraday rows (`getIntradayTrades` alias); and
- the previous-session opening print (`getPreviousOpen`).

The repository can accommodate synchronous or promise-returning provider methods through `ProviderRepository`, but the current HTTP `MarketService` path is synchronous. An asynchronous network adapter must be wired into an explicit ingestion/materialization path before it is used by HTTP; adding async methods alone does not make a real adapter operational.

All current API responses truthfully report:

```json
{
  "dataMode": "mock",
  "calculationMode": "exact"
}
```

`dataMode: "mock"` identifies deterministic generated observations. `calculationMode: "exact"` means the engine aggregates each supplied trade row exactly after integer-paise normalization. It does not mean the mock rows are complete, real, exchange-certified, or suitable for trading decisions.

## Exact versus estimated data

The V1 calculation is exact only when the source supplies execution-level observations for the whole selected session (including quantity, price, timestamp, instrument identity, and a defined correction/duplicate policy). Grouping those rows into buckets is exact relative to the received set.

OHLCV candles are insufficient to determine a volume-at-price distribution: a candle reports total volume over a time/price range, not how quantity was distributed inside that range. A provider that supplies only candles must use a separately named estimated mode and disclose its method, for example:

- `dataMode: "provider"` or another source-specific label; and
- `calculationMode: "estimated"` with the candle interval, allocation rule, coverage, and uncertainty visible to the client.

It must never label candle-derived allocation as `exact`, and it must not silently mix estimated buckets with exact trade buckets. If a provider supplies delayed, sampled, aggregated, partial, or quote-only observations, preserve those limitations in a quality state and source metadata rather than implying complete trade history.

## Required normalized contract

A production adapter should normalize source records before persistence:

| Input | Required rule |
| --- | --- |
| Symbol/contract | Map through an authoritative instrument/contract master. Keep exchange token, expiry, series, and source identifier where relevant; reject ambiguous mappings. |
| Session date/time | Parse source timezone explicitly, convert to IST session date, and enforce the NSE session boundary. Do not infer dates from the host timezone. |
| Price | Preserve the source tick size and normalize to integer paise (or a documented finer integer unit) before bucketing. Reject non-positive or malformed values. |
| Quantity | Preserve executed quantity as a positive integer. Do not confuse notional value, lot count, or quote size with traded quantity. |
| Side | Preserve `BUY`/`SELL` only when source semantics are known. If side is unavailable, use an explicit null/unknown representation in a future schema—not a fabricated side. |
| Timestamp/order | Preserve source ordering and a deterministic tie key. Handle duplicate, corrected, late, and out-of-order messages according to a documented source policy. |
| Previous open | Fetch the first valid print for the immediately preceding trading session from the same instrument definition, or mark it unavailable. Never substitute the selected session's open or a reference metadata field without labeling it. |
| Coverage | Record requested interval, received interval, row count, gaps, and whether the feed is complete before exposing a result as exact. |

The current `Trade` type has the normalized fields needed by the mock path. A real adapter may need additional persistence for source event IDs, revisions, contract expiry, ingestion batch, correction state, and coverage intervals; those additions should be implemented with migrations and tests rather than hidden in free-form fields.

## Integration stages

1. **Provider capability check:** document licensing, exchange permissions, symbol master, historical retention, tick/trade granularity, delays, rate limits, and correction behavior. Do not start with a credential-shaped environment variable and assume the feed is usable.
2. **Instrument and calendar snapshot:** load an authoritative NSE instrument/contract master and a complete holiday/session calendar. Version both snapshots and retain the effective date.
3. **Historical backfill:** request one session and one instrument, paginate safely, persist raw/source identifiers where licensed, normalize to the V1 contract, and calculate coverage. Verify row counts and first/last timestamps.
4. **Previous-open validation:** independently verify the prior-session opening print and session linkage. Missing or conflicting values must produce `Previous open unavailable` or a provider-quality state.
5. **Quality gates:** reject malformed prices/quantities, detect duplicates and gaps, monitor late corrections, and attach source/coverage metadata to the result. A partial feed must not pass as exact.
6. **Replay comparison:** compare a provider session against a trusted report or fixture using documented tolerances. Test weekends, holidays, corporate-action/contract changes, missing data, retries, and restarts.
7. **Operational ingestion:** run a server-side scheduled job with bounded retries, rate limiting, backoff, idempotent checkpoints, metrics, and alerting. Keep ingestion separate from browser requests so one user cannot trigger an uncontrolled provider fan-out.
8. **Explicit rollout:** keep mock mode as the no-credential default. Enable a real adapter only after tests and coverage gates pass; expose source and calculation labels in health, scanner, profile, and monitoring views.

## What is not implemented

The repository does not currently provide:

- NSE authentication, API keys, exchange licensing, or a guaranteed official execution feed;
- a real provider implementation or credential validation;
- an authoritative, maintained NSE holiday/calendar or contract master;
- historical tick backfill, pagination/checkpointing, source-event deduplication, corrections, or late-trade reconciliation;
- feed completeness metrics, raw payload retention, or provider-specific rate-limit/retry handling;
- candle-to-volume-at-price estimation; or
- brokerage, order placement, recommendations, alerts, or account access.

Free, delayed, quote-only, or OHLCV endpoints may be useful for experiments, but their availability and license do not establish that they can support this product's exact trade-level calculation. Confirm the provider's current terms and capabilities independently before integration.

## Security and deployment boundary

Provider credentials, signing keys, raw payloads, and server-side access tokens must stay in the backend runtime or a secret manager. Never use `VITE_*` for a secret: Vite embeds those values into browser assets. Do not log authorization headers, tokens, or full sensitive payloads.

The current app defaults to `HOST=127.0.0.1`, has no authentication/authorization, and is intended for a trusted local developer. Before binding it to a shared interface or internet-facing reverse proxy, add an authenticated gateway, TLS, origin policy, request limits, audit logging, secret rotation, and a protected database/backup path. CORS is not authentication. Provider credentials must not be accepted from browser query parameters.

Production deployment should run the compiled backend (`npm run build`, then `npm start --workspace backend`) behind a process supervisor and reverse proxy. Serve the compiled frontend separately and proxy `/api` and the SSE endpoint to the backend with buffering disabled for SSE. Use a persistent, access-controlled SQLite volume for a single-instance deployment, or replace SQLite and the in-process live clock with shared durable infrastructure before horizontal scaling. The mock/simulated stream is not a production market-data transport.

## Acceptance checklist

A provider is ready for an exact-mode trial only when all answers are demonstrably yes:

- Are the instrument identity, tick size, and contract metadata authoritative for the selected session?
- Is the exchange calendar and session boundary complete for the backfill range?
- Are all executions (not just candles, quotes, or sampled prints) available, with quantity and deterministic source IDs?
- Can duplicates, corrections, late rows, gaps, and partial responses be detected and reconciled?
- Is the previous-session open sourced and validated independently of the selected session?
- Are rate limits, retries, checkpoints, credentials, licensing, and retention documented?
- Do API/UI labels distinguish provider source, exactness, delay, and coverage?

If any answer is no, keep the source in mock or explicitly estimated/partial mode and expose the limitation. Do not ship a green `exact` label by assumption.
