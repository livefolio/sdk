<!-- Parent: ../AGENTS.md -->

# src/interfaces

## Purpose
The v0.4 type surface. Pure type-only declarations — no runtime code. Defines the contracts that runtime layers (data feeds, executors, calendars, feature caches) and strategies satisfy. Every concrete impl in `src/reference/` implements an interface declared here.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | Primitive types: `Asset`, `AssetId`, `Bar`, `DateRange`, `Frequency`, `Series` |
| `data-feed.ts` | `DataFeed` interface (`bars(asset, range, freq) → AsyncIterable<Bar>`); also `Fundamentals`, `EventKind`, `DataEvent` for richer feeds |
| `streaming-data-feed.ts` | `StreamingDataFeed` interface (`subscribe(assets) → AsyncIterable<StreamingBar>`) — sibling to `DataFeed`, purely additive (no union, no shared type with `DataFeed`). Consumed by `runLive`; aggregation/session boundaries are runtime concerns owned by `Calendar`, not the feed |
| `quote-feed.ts` | `QuoteFeed` interface (`quote(asset) → Promise<Quote>`, optional `quoteBatch`) — sibling to `DataFeed` and `StreamingDataFeed`. Covers one-shot pull quotes (UI refresh, pre-trade sizing, ad-hoc CLI). Not consumed by `runBacktest` / `runLive`; app-side seam |
| `executor.ts` | `Executor` interface (`submit(orders, t, portfolio) → Fill[]`) |
| `calendar.ts` | `Calendar` interface (`isOpen`, `next`, `previous`, `sessions`) |
| `feature-cache.ts` | `FeatureCache` interface plus `FeatureKey`, `FeatureScope` |
| `index.ts` | Barrel — re-exports all type symbols |

## For AI Agents

### Working In This Directory
- Type-only — no runtime imports allowed. Every file should compile to nothing
- This is the contract layer: changes here ripple through `src/strategy/`, `src/features/`, `src/reference/`, and downstream packages (`@livefolio/yfinance`)
- New interface? Add it here, export from `index.ts`, then implement in `src/reference/` (or a downstream package)
- Tests: mostly nonexistent — these are pure types. `streaming-data-feed.test.ts` is a tiny structural-conformance test for the `StreamingDataFeed` shape. Conformance is otherwise verified by the implementations passing their own tests

### Common Patterns
- Interfaces use `readonly` aggressively; mutability is opt-in
- `AsyncIterable` for `DataFeed.bars` (bounded, lazy) and `StreamingDataFeed.subscribe` (open-ended, push-shaped); the runtime treats `for await` over `subscribe` as the live loop
- `Frequency = '1m' | '5m' | '15m' | '1h' | '1d'` — most strategies use `'1d'`; subdaily values exist in the type but reference impls today only handle daily
- `DataFeed`, `StreamingDataFeed`, and `QuoteFeed` are sibling interfaces — NOT a union, NO composition helper, NO backward-compat aliases. Vendors implement whichever subset matches their surface; combined vendors (Alpaca, Polygon) implement all three on one class
