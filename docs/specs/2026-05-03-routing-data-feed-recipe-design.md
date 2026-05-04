# Recipe — Composing data feeds with `RoutingDataFeed` (and tactical/v1 macro support)

**Status:** Design
**Date:** 2026-05-03
**Scope:** SDK repo (`@livefolio/sdk`)

## Motivation

Two recently-shipped pieces — `RoutingDataFeed` (commit `bcf5733`) and `@livefolio/fred` (sibling repo) — let consumers compose vendor data feeds behind a single `DataFeed` interface. There is no documentation for either yet, and the docs site has no end-to-end example showing how a `TacticalSpec` author wires multi-source data into a strategy.

Worse: when we wrote the recipe and tried to express it as a `TacticalSpec`, we discovered the tactical/v1 dialect **silently coerces every universe asset to `kind: 'equity'`**, which means a `DGS10` macro asset routed through `RoutingDataFeed` would be sent to the equity feed, not FRED. Three sites in `src/tactical/` hardcode the discriminator, and `AssetRef` itself has no `kind` field. The dialect-side fix is small but blocks the recipe.

This spec bundles both concerns into one shippable unit: extend tactical/v1 to support macro asset kinds, then write the recipe that demonstrates it end-to-end.

## Non-goals

- **No new asset kinds beyond `'macro'`.** `'futures'`, `'option'`, `'crypto'` are out of scope; they ship when their respective adapter packages do.
- **No new feature kinds.** The recipe uses the existing `kind: 'price'` feature on a `MacroAsset`; this works because FRED bars are degenerate OHLCV (`close = published value`).
- **No live FRED execution from the runnable.** The example uses synthetic in-memory fixtures so `npx tsx scripts/docs/recipes/composing-data-feeds.ts` runs offline. Real Yahoo + FRED wiring is shown in the markdown but not exercised by `docs:check`.
- **No new TypeDoc page or guide chapter.** The recipe + the existing TacticalSpec authoring guide cover the surface area. A future "Tactical for macro strategies" guide is YAGNI today.
- **No codemod / migration.** The `kind` field is optional with `'equity'` as the default, so existing specs continue to work unchanged.

## Design

### Part 1 — Extend tactical/v1 for macro assets

#### `AssetRef` adds an optional `kind`

```ts
// src/tactical/types.ts
export type AssetRef = {
  id: AssetId;
  symbol: string;
  exchange?: string;
  /** Asset class. Defaults to `'equity'` when omitted. Add `'macro'` to author
   *  FRED-style time-series assets that route to a non-equity DataFeed. */
  kind?: 'equity' | 'macro';
};
```

The default is `'equity'` so every existing v0.4 `TacticalSpec` continues to type-check and produces the same `Asset` objects it did before.

#### Extract `resolveAsset` to a shared module

Three modules currently inline an identical 3-line `resolveAsset` helper:

- `src/tactical/from-spec.ts:46-48`
- `src/tactical/synthetics.ts:6-8`
- `src/tactical/evaluate-feature-specs.ts:7-9`

Hardcoding `kind: 'equity'` in three places was tolerable when the body never changed; it becomes error-prone the moment we add a discriminator. Extract once:

```ts
// src/tactical/asset-ref.ts (NEW)
import type { Asset } from '../interfaces/types';
import type { AssetRef } from './types';

/**
 * Resolves a {@link AssetRef} to a v0.4 {@link Asset}. The `kind` field on the
 * ref selects the variant; absent `kind` defaults to `'equity'` for backward
 * compatibility with v0.4 specs authored before macro support landed.
 */
export function resolveAssetRef(ref: AssetRef): Asset {
  if (ref.kind === 'macro') {
    return { kind: 'macro', id: ref.id, symbol: ref.symbol };
  }
  // Default: equity. exchange is preserved when present.
  return ref.exchange !== undefined
    ? { kind: 'equity', id: ref.id, symbol: ref.symbol, exchange: ref.exchange }
    : { kind: 'equity', id: ref.id, symbol: ref.symbol };
}
```

The three call sites import and use it. The local copies are deleted.

#### Tests

Add `src/tactical/asset-ref.test.ts`:

- `kind: 'macro'` ref → `MacroAsset` (no `exchange` field).
- `kind: 'equity'` ref with `exchange` → `EquityAsset` with `exchange`.
- `kind: 'equity'` ref without `exchange` → `EquityAsset` without `exchange`.
- Omitted `kind` → defaults to `EquityAsset` (backward compat).

Add to `src/tactical/from-spec.test.ts`: a `TacticalSpec` whose `universe` contains both an equity and a macro asset; assert that `strategy.universe(t, portfolio)` returns the correct mixed-kind union.

### Part 2 — Runnable recipe script

`scripts/docs/recipes/composing-data-feeds.ts`. Mirrors the `multi-asset-trend.ts` template (synthetic fixtures, end-to-end backtest, console summary), and the script type-checks via `docs:check` and runs via `npx tsx`.

Strategy: **single-yield gate**.

- Universe: `SPY`, `TLT` (equity); `DGS10` (macro).
- One feature: `{ id: 'dgs10_yield', kind: 'price', asset: DGS10 }` — reads the latest published 10y yield as a number.
- Rebalance: monthly (first trading day).
- Rule:
  ```
  if dgs10_yield > 4.5  →  100% TLT
  else                  →  100% SPY
  ```

Two in-memory feeds:

- **`equityFeed`** — yields synthetic SPY and TLT bars (SPY drifts up at +4 bps/day, TLT drifts down at −1 bp/day, a sine cycle adds ±60 bps noise).
- **`macroFeed`** — yields synthetic DGS10 bars where the close oscillates between roughly 3.8% and 5.0% with a ~6-month period, crossing the 4.5% threshold in both directions during a 1-year window so the recipe demonstrates regime changes.

Composition:

```ts
const dataFeed = new RoutingDataFeed({
  equity: equityFeed,
  macro:  macroFeed,
});
```

The script ends with a console summary: total sessions, rebalance count, final cash, terminal positions, and a 4-line "regime distribution" showing how many sessions favored TLT vs SPY.

### Part 3 — Recipe markdown

`docs-site/recipes/composing-data-feeds.md`. Sections:

1. **Hook** (3 sentences) — most strategies want data from more than one vendor; tactical/v1 supports this via `AssetRef.kind` plus `RoutingDataFeed`; this recipe builds a yield-gated SPY/TLT switcher driven by FRED's `DGS10`.
2. **The strategy** — 4-line restatement of the rule.
3. **Wiring the universe** — show the spec snippet with the inline `kind: 'macro'` annotation; explain the default.
4. **Composing the feeds** — show `new RoutingDataFeed({ equity, macro })`; explain that the keys are `Asset['kind']` discriminants and the constructor also accepts a function for predicate routing.
5. **Production wiring** (own subsection) — show real `YfinanceDataFeed` + `FredDataFeed` imports and construction. Markdown-only; the runnable uses synthetic feeds because FRED requires an API key.
6. **Full code** — embed the runnable verbatim.
7. **What you should see** — paste actual console output of the script.

### Part 4 — Sidebar + cross-link

`docs-site/.vitepress/config.ts`: append a sidebar entry under Recipes:

```ts
{ text: 'Composing data feeds', link: '/recipes/composing-data-feeds' },
```

`docs-site/guides/runtime/custom-data-feed.md`: add a one-paragraph "Composing multiple feeds" section near the top that points to:

- `RoutingDataFeed` API page (auto-generated by TypeDoc from the SDK source).
- The new recipe.

The guide remains the canonical "how to write your own DataFeed"; the new section is a 4-sentence pointer for "what if you want to combine several."

## Errors / edge cases

- **`AssetRef` with `kind: 'macro'` and `exchange`.** `exchange` is silently dropped when resolving to a `MacroAsset` (the `MacroAsset` shape doesn't carry it). This is correct; flagging it as an error is over-engineering. The TypeScript type still permits the combination because `exchange` is optional on `AssetRef` regardless of `kind`.
- **`kind`-mismatched FeatureSpec.** A user who writes `{ kind: 'price', asset: DGS10 }` where `DGS10.kind = 'macro'` will get the macro asset's bars routed correctly through `RoutingDataFeed`; no special handling needed at the dialect layer.
- **Recipe runnable without a registered `macro` route.** If a reader copies the recipe but forgets `macro` in the route map, `RoutingDataFeed.bars(DGS10, ...)` throws `RoutingDataFeedError: no feed registered for asset.kind="macro"...`. The recipe text calls this out explicitly so the error is recognizable.

## File changes

| File | Change |
|---|---|
| `src/tactical/types.ts` | Add `kind?: 'equity' \| 'macro'` to `AssetRef` |
| `src/tactical/asset-ref.ts` | NEW: `resolveAssetRef` helper |
| `src/tactical/asset-ref.test.ts` | NEW: 4 tests covering each variant |
| `src/tactical/from-spec.ts` | Replace local `resolveAsset` with import |
| `src/tactical/synthetics.ts` | Replace local `resolveAsset` with import |
| `src/tactical/evaluate-feature-specs.ts` | Replace local `resolveAsset` with import |
| `src/tactical/from-spec.test.ts` | Add a mixed-kind universe test |
| `src/tactical/index.ts` | No change — `resolveAssetRef` is an internal helper, not part of the public surface |
| `scripts/docs/recipes/composing-data-feeds.ts` | NEW: runnable recipe |
| `docs-site/recipes/composing-data-feeds.md` | NEW: recipe page |
| `docs-site/.vitepress/config.ts` | Sidebar entry |
| `docs-site/guides/runtime/custom-data-feed.md` | One-paragraph "Composing multiple feeds" section |

## Tests

The implementation plan derived from this spec must verify:

1. `resolveAssetRef` produces correct `Asset` variants for each input shape (4 cases).
2. `from-spec` honors `kind: 'macro'` end-to-end through the strategy lifecycle.
3. Existing v0.4 specs (no `kind`) continue to type-check and produce `EquityAsset` (regression).
4. The new runnable type-checks under `docs:check`.
5. The new runnable executes successfully under `npx tsx` and prints a deterministic summary.
6. `npm test`, `npm run build`, `npm run lint`, `npm run docs:check` all pass.

## Out of scope (deferred)

- Other asset kinds (`'futures'`, `'option'`, `'crypto'`) — add when their adapters ship.
- A "Tactical for macro strategies" guide page — YAGNI; the recipe is sufficient.
- TypeDoc-rendered API page customization for `AssetRef` — JSDoc on the field will flow through automatically.
- A live-FRED variant of the runnable. Adding one would require either committing a key (no) or skipping the script in `docs:check` when the key is absent (added complexity for marginal value).
