# `@livefolio/fred` adapter — design

**Status:** Design
**Date:** 2026-05-03
**Scope:** New repo `/Users/raksi/Documents/Personal/livefolio-2/fred/`, package `@livefolio/fred@0.1.0`. Sibling to `@livefolio/yfinance`.

## Motivation

Tactical/v1 strategies need macro time series (FRED-published yields, CPI, unemployment, etc.) alongside equity bars. The v0.4 SDK already accepts multi-source `DataFeed`s via `RoutingDataFeed` (companion spec: `2026-05-03-v0.4-routing-data-feed-design.md`); what's missing is a FRED `DataFeed` to plug into the `macro` slot:

```ts
const feed = new RoutingDataFeed({ equity: yahoo, macro: fred });
```

This package ships exactly that — a single `DataFeed` whose `bars()` returns FRED observations as degenerate OHLCV bars (`open=high=low=close=value`, `volume=0`).

## Non-goals

- **No browser build.** FRED's REST API requires the API key in the URL; exposing it client-side leaks the key. Consumers wanting browser-side FRED data introduce a proxy server, which is outside this package.
- **No `fundamentals()`, no `events()`.** The optional `DataFeed` capabilities are intentionally absent. Series metadata (description, units, last-updated) is YAGNI for tactical/v1 — strategies only consume the values.
- **No upsampling, downsampling, or forward-fill.** The adapter is a dumb pass-through: it passes the asset's `id` to FRED as the `series_id` and yields whatever observations FRED returns at the series' native cadence. A `MacroAsset` with `id: 'CPIAUCSL'` (monthly) requested with `freq: '1d'` produces sparse monthly bars; running `sma(20)` over that series is the consumer's responsibility.
- **No retry / backoff / rate limiting.** Backtests fetch each series once via the in-process cache; FRED's 120 req/min limit is unreachable in practice.
- **No pagination.** FRED's `observations` endpoint defaults `limit=100000` (also the max), which covers decades of any series. A future paginating client is out of scope.
- **No `freq` translation.** Only `freq: '1d'` is accepted. Anything else throws at the call boundary; FRED has no concept of intraday observations.

## Public API

```ts
import { FredDataFeed } from '@livefolio/fred';

const fred = new FredDataFeed({ apiKey: process.env.FRED_API_KEY! });

for await (const bar of fred.bars(
  { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' },
  { from: new Date('2024-01-01'), to: new Date('2025-01-01') },
  '1d',
)) {
  // bar.t     = midnight UTC of the publish date
  // bar.close = 4.21 (rate, percent)
  // bar.open = bar.high = bar.low = bar.close
  // bar.volume = 0
}
```

```ts
export type FredFetcher = (
  seriesId: string,
  range: DateRange,
  opts: { apiKey: string },
) => Promise<Bar[]>;

export type FredDataFeedOptions = {
  /** Required. Free FRED API key from https://fred.stlouisfed.org/docs/api/api_key.html */
  apiKey: string;
  /** Override the live fetcher. Tests inject a fixture-backed fetcher to stay offline. */
  fetcher?: FredFetcher;
};

export class FredDataFeed implements DataFeed {
  constructor(opts: FredDataFeedOptions);
  bars(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar>;
}
```

## Architecture

Mirrors `yfinance/src/` 1:1.

| File | Responsibility |
|---|---|
| `src/asset.ts` | `assetToFredSeriesId(asset: Asset): string` — narrows to `MacroAsset`, returns `asset.id`. Throws on `kind !== 'macro'`. |
| `src/fred-client.ts` | `fetchFredObservations(seriesId, range, { apiKey }): Promise<Bar[]>` — REST call, JSON parse, missing-value drop, observation→Bar mapping. Pure transport. |
| `src/cache.ts` | `BarCache` — copied verbatim from `@livefolio/yfinance`. Range-aware, freq-keyed, per-instance, no eviction. |
| `src/fred-data-feed.ts` | `FredDataFeed implements DataFeed`. Composition: `assetToFredSeriesId → BarCache → fetchFredObservations`, plus `inflight: Map<string, Promise<Bar[]>>` for concurrent dedup. Throws on `freq !== '1d'`. |
| `src/index.ts` | Barrel: `FredDataFeed`, `FredDataFeedOptions`, `FredFetcher`, `fetchFredObservations`, `assetToFredSeriesId`. |

The `assetToFredSeriesId → BarCache → fetchFredObservations` pipeline mirrors `yfinance` exactly. Future adapters (other macro providers, options-chain feeds) are expected to follow the same template.

## Bar mapping

FRED's `series/observations` endpoint returns:

```json
{
  "observations": [
    { "date": "2024-01-02", "value": "3.95", "realtime_start": "...", "realtime_end": "..." },
    { "date": "2024-01-03", "value": ".",    "realtime_start": "...", "realtime_end": "..." }
  ]
}
```

Mapping rules:

- `value === '.'` → **drop the row** (FRED's missing-value sentinel).
- Otherwise: `Bar { t: new Date(`${date}T00:00:00Z`), open=high=low=close=parseFloat(value), volume=0 }`.

The SDK's `DateRange` is half-open `[from, to)`. FRED's `observation_start` and `observation_end` are both inclusive, so the client sends `observation_end = (to - 1 day in YYYY-MM-DD)` to honor the exclusive `to`.

Date strings are sent / parsed as `YYYY-MM-DD` and coerced to UTC midnight on the way in. Output bars are deterministically UTC-aligned.

## Errors

The package throws plain `Error` objects (no custom error class — the failure modes are coarse-grained).

| Cause | Behavior |
|---|---|
| `freq !== '1d'` | Throw at the start of `bars()`. Message includes the freq. |
| `asset.kind !== 'macro'` | Throw from `assetToFredSeriesId`. Message includes the kind and id. |
| FRED HTTP non-2xx | Throw from `fetchFredObservations`. Message includes status + FRED's response body. |
| FRED 200 with `error_message` field | Throw. (FRED sometimes returns 200 with an error body.) |
| `fetch` itself rejects (network) | Propagate without wrapping. |

The throws inside `bars()` happen *inside the async generator body*, which means they surface as a rejection on the first `next()` call, consistent with how `RoutingDataFeed.bars` propagates errors.

## Configuration

`FRED_API_KEY` is **not** auto-read from the environment. Consumers pass it explicitly. This matches the `yfinance` pattern (no implicit env wiring).

## Tests

| File | Coverage |
|---|---|
| `test/asset.test.ts` | Happy path returns `asset.id`. `kind: 'equity'` throws with kind+id in message. |
| `test/cache.test.ts` | Copied from yfinance — range-aware get, superset widen, partial-overlap throw. |
| `test/fred-client.test.ts` | Mocked `fetch`. Covers: happy path, missing-value drop, half-open boundary (`observation_end = to - 1d`), HTTP 4xx, 200-with-error_message, network rejection. |
| `test/fred-data-feed.test.ts` | Injected fetcher. Covers: bar caching dedup (second call hits cache), inflight dedup (two concurrent calls share one fetch), asset normalization (rejects non-macro), freq rejection (`'1h'` throws), `'fundamentals' in feed === false`, `'events' in feed === false`. |
| `test/integration.test.ts` | Gated on `process.env.FRED_API_KEY`. Hits the live API for DGS10 over a known week, asserts the response contains expected dates and a numeric value. Skipped when the env var is absent. |

No fixture-recording script. FRED responses are small, hand-written JSON suffices; a recording script would be extra surface for no benefit.

## Repo skeleton

The repo at `/Users/raksi/Documents/Personal/livefolio-2/fred/` mirrors `yfinance/`:

```
fred/
├─ AGENTS.md
├─ CLAUDE.md         (→ AGENTS.md)
├─ LICENSE           (MIT)
├─ README.md
├─ docs/
│  ├─ AGENTS.md
│  ├─ specs/
│  └─ plans/
├─ src/
│  ├─ asset.ts
│  ├─ asset.test.ts
│  ├─ cache.ts
│  ├─ cache.test.ts
│  ├─ fred-client.ts
│  ├─ fred-client.test.ts
│  ├─ fred-data-feed.ts
│  ├─ fred-data-feed.test.ts
│  ├─ integration.test.ts
│  └─ index.ts
├─ eslint.config.js  (copy from yfinance)
├─ tsconfig.json     (copy)
├─ tsup.config.ts    (copy)
├─ vitest.config.ts  (copy)
└─ package.json
```

`package.json` mirrors `@livefolio/yfinance` shape with these substitutions:

- `name`: `@livefolio/fred`
- `description`: `FRED (St. Louis Fed) macro time series adapter for @livefolio/sdk v0.4. Node-only DataFeed implementation; pass-through observations as OHLCV bars.`
- `keywords`: `['fred', 'macro', 'datafeed', 'backtest', 'livefolio', 'tactical-allocation']`
- `dependencies`: none (uses native `fetch`)
- `peerDependencies`: `@livefolio/sdk: ^0.4.0`
- `devDependencies`: same toolchain as yfinance (eslint, prettier, tsup, tsx, typescript, typescript-eslint, vitest, @types/node, `@livefolio/sdk: file:../sdk`)
- No `workspaces` field — no `browser/` subworkspace until a browser-safe variant is justified.

`README.md` documents the public API and points to the SDK's `RoutingDataFeed` recipe (eventual follow-up).

## Out of scope (deferred)

- Browser build (`@livefolio/fred-browser`) — requires a proxy server pattern; revisit when the hosted product needs it.
- `fundamentals()` for FRED's metadata endpoints — useful for a UI, not for tactical signals.
- ALFRED real-time vintage data (`realtime_start`/`realtime_end` filtering) — current adapter ignores vintages and returns the latest revision.
- A docs-site recipe walking through Yahoo + FRED composition — track separately.
