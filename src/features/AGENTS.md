<!-- Parent: ../AGENTS.md -->

# src/features

## Purpose
The feature library. Pure indicator math operating on `Series`, content-addressed feature specs, and the `FeatureRuntime` orchestrator that pulls bars from a `DataFeed`, computes indicators, and memoizes results in a `FeatureCache`.

## Key Files

| File | Description |
|------|-------------|
| `indicators/` | Pure indicator functions: `sma`, `ema`, `rsi`, `returnSeries`, `volatility`, `drawdown`. Each takes a `Series` and returns a `Series` |
| `series-utils.ts` | `collectBars`, `barsToSeries`, `seriesAt` — helpers for `Bar[] ↔ Series` conversion |
| `spec.ts` | `FeatureSpec` registry: `defineFeature`, `getFeatureCompute`, `paramsHash` (content-addressing) |
| `runtime.ts` | `FeatureRuntime`: orchestrates `DataFeed → indicator → FeatureCache`. The bridge between strategy code and the data layer |
| `index.ts` | Barrel — re-exports indicators, series utils, `FeatureRuntime`, `FeatureSpec` |

## For AI Agents

### Working In This Directory
- Indicators are **pure**: same input → same output. No `Date.now()`, no I/O, no mutation
- Indicators operate on `Series` (`{t, v}[]`), not `Bar[]`. Use `barsToSeries(bars, 'close')` to convert
- New indicator? (a) write a pure function in `indicators/`, (b) register it via `defineFeature(...)` so spec-driven strategies can reference it by `kind`
- `FeatureRuntime` memoizes per `(spec, asset)` for the lifetime of one runtime instance — not across runtime constructions

### Testing Requirements
- Indicator unit tests live in `indicators/<x>.test.ts`
- Cross-version parity (v0.4 vs v0.3) lives in `parity/src/indicator-parity/<x>.test.ts`
- `runtime.test.ts` covers cache-hit/cache-miss, `DataFeed` integration

### Common Patterns
- **Content-addressed cache keys** — `paramsHash(spec)` produces a deterministic hash of the spec; the cache key combines that with `asset.id` and date
- **Lazy bar loading** — `FeatureRuntime` calls `DataFeed.bars` once per (asset, range) and memoizes; multiple features over the same asset share a single bar fetch
