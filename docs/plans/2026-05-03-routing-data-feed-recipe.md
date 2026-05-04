# RoutingDataFeed Recipe + tactical/v1 Macro Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document `RoutingDataFeed` end-to-end for tactical/v1 authors with a runnable recipe, gated by a tiny dialect change that lets `TacticalSpec.universe` carry macro asset kinds.

**Architecture:** Add an optional `kind` discriminator to `AssetRef` (default `'equity'`, backward-compatible). Extract the triplicated `resolveAsset` helper into one shared module so the discriminator only has to be honored in one place. Then ship a runnable script + markdown recipe + sidebar entry + a one-paragraph cross-link in the existing custom-data-feed guide.

**Tech Stack:** TypeScript (strict, ESM), Vitest, tsup, VitePress + TypeDoc. Companion spec: `docs/specs/2026-05-03-routing-data-feed-recipe-design.md`.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/tactical/types.ts` | Modify | Add `kind?: 'equity' \| 'macro'` to `AssetRef` |
| `src/tactical/asset-ref.ts` | Create | `resolveAssetRef(ref)` — sole resolver |
| `src/tactical/asset-ref.test.ts` | Create | 4 unit tests + backward-compat case |
| `src/tactical/from-spec.ts` | Modify | Replace local `resolveAsset` with import |
| `src/tactical/synthetics.ts` | Modify | Replace local `resolveAsset` with import |
| `src/tactical/evaluate-feature-specs.ts` | Modify | Replace local `resolveAsset` with import |
| `src/tactical/from-spec.test.ts` | Modify | Add a mixed-kind universe test |
| `scripts/docs/recipes/composing-data-feeds.ts` | Create | Runnable recipe (synthetic feeds + tactical/v1 + RoutingDataFeed) |
| `docs-site/recipes/composing-data-feeds.md` | Create | Recipe markdown |
| `docs-site/.vitepress/config.ts` | Modify | Sidebar entry under Recipes |
| `docs-site/guides/runtime/custom-data-feed.md` | Modify | One-paragraph "Composing multiple feeds" section |

---

### Task 1: Extend `AssetRef` and extract `resolveAssetRef`

**Goal:** Add an optional `kind?: 'equity' | 'macro'` field to `AssetRef`, extract the triplicated `resolveAsset` helper into one shared module, and update the three call sites to import it. `'equity'` remains the default so every existing v0.4 spec keeps working.

**Files:**
- Modify: `src/tactical/types.ts:12-23` (the `AssetRef` definition)
- Create: `src/tactical/asset-ref.ts`
- Create: `src/tactical/asset-ref.test.ts`
- Modify: `src/tactical/from-spec.ts:45-49` (drop local `resolveAsset`, import the new helper)
- Modify: `src/tactical/synthetics.ts:5-9` (drop local `resolveAsset`, import the new helper)
- Modify: `src/tactical/evaluate-feature-specs.ts:6-10` (drop local `resolveAsset`, import the new helper)
- Modify: `src/tactical/from-spec.test.ts` (add a mixed-kind universe test)

**Acceptance Criteria:**
- [ ] `AssetRef` accepts an optional `kind: 'equity' | 'macro'`
- [ ] `resolveAssetRef({ kind: 'macro', id: 'DGS10', symbol: '10Y' })` returns `{ kind: 'macro', id: 'DGS10', symbol: '10Y' }`
- [ ] `resolveAssetRef({ id: 'AAPL', symbol: 'AAPL', exchange: 'NASDAQ' })` returns `{ kind: 'equity', id: 'AAPL', symbol: 'AAPL', exchange: 'NASDAQ' }` (default-equity branch)
- [ ] `resolveAssetRef({ id: 'AAPL', symbol: 'AAPL' })` returns `{ kind: 'equity', id: 'AAPL', symbol: 'AAPL' }` (no `exchange` in output)
- [ ] `resolveAssetRef({ kind: 'equity', id: 'AAPL', symbol: 'AAPL' })` matches the no-`kind` case (explicit equity behaves like default)
- [ ] No file in `src/tactical/` defines a local `resolveAsset` anymore — `grep -r "function resolveAsset" src/tactical/` returns nothing
- [ ] `from-spec.test.ts` has a test that builds a `TacticalSpec` with both an equity and a macro `AssetRef` and verifies `strategy.universe(...)` returns the union
- [ ] `npm test && npm run build && npm run docs:check && npm run lint` all green

**Verify:** `npm test && npm run build && npm run docs:check && npm run lint`

**Steps:**

- [ ] **Step 1: Modify `src/tactical/types.ts` — extend `AssetRef`**

Replace the existing `AssetRef` block at lines 6-23 (the JSDoc + type) with:

```ts
/**
 * A reference to an asset within a {@link TacticalSpec}. Unlike the runtime
 * {@link Asset} type, `AssetRef` is the spec-form representation: it lives
 * inside serialized JSON specs and carries only the fields a spec author
 * needs to declare.
 *
 * `id` is the stable opaque identifier (see {@link AssetId}); `symbol` is the
 * human-readable ticker; `exchange` is optional. `kind` selects the asset
 * variant; absent `kind` defaults to `'equity'` for backward compatibility
 * with v0.4 specs authored before macro support landed.
 */
export type AssetRef = {
  /** Stable opaque asset identifier matching {@link AssetId}. */
  id: AssetId;
  /** Human-readable ticker symbol, e.g. `'AAPL'`. */
  symbol: string;
  /** Optional MIC or common exchange name, e.g. `'NYSE'`. Equity-only. */
  exchange?: string;
  /**
   * Asset class. Defaults to `'equity'` when omitted. Set to `'macro'` to
   * author FRED-style time-series assets that route to a non-equity
   * `DataFeed` (typically via `RoutingDataFeed`).
   */
  kind?: 'equity' | 'macro';
};
```

- [ ] **Step 2: Create `src/tactical/asset-ref.ts`**

```ts
import type { Asset } from '../interfaces/types';
import type { AssetRef } from './types';

/**
 * Resolves a spec-form {@link AssetRef} to a runtime {@link Asset}. The
 * `kind` field on the ref selects the variant; absent `kind` defaults to
 * `'equity'` for backward compatibility.
 *
 * Pure. No I/O. Used by `fromSpec`, `withSynthetics`, and
 * `evaluateFeatureSpecs` so the resolution rule lives in one place.
 */
export function resolveAssetRef(ref: AssetRef): Asset {
  if (ref.kind === 'macro') {
    return { kind: 'macro', id: ref.id, symbol: ref.symbol };
  }
  return ref.exchange !== undefined
    ? { kind: 'equity', id: ref.id, symbol: ref.symbol, exchange: ref.exchange }
    : { kind: 'equity', id: ref.id, symbol: ref.symbol };
}
```

- [ ] **Step 3: Create `src/tactical/asset-ref.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveAssetRef } from './asset-ref';

describe('resolveAssetRef', () => {
  it('produces a MacroAsset when ref.kind === "macro"', () => {
    const out = resolveAssetRef({ kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' });
    expect(out).toEqual({ kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' });
  });

  it('produces an EquityAsset with exchange when ref.exchange is defined', () => {
    const out = resolveAssetRef({ id: 'AAPL', symbol: 'AAPL', exchange: 'NASDAQ' });
    expect(out).toEqual({ kind: 'equity', id: 'AAPL', symbol: 'AAPL', exchange: 'NASDAQ' });
  });

  it('produces an EquityAsset without exchange when ref.exchange is undefined', () => {
    const out = resolveAssetRef({ id: 'AAPL', symbol: 'AAPL' });
    expect(out).toEqual({ kind: 'equity', id: 'AAPL', symbol: 'AAPL' });
    expect('exchange' in out).toBe(false);
  });

  it('treats explicit kind: "equity" the same as the default', () => {
    const explicit = resolveAssetRef({ kind: 'equity', id: 'SPY', symbol: 'SPY' });
    const implicit = resolveAssetRef({ id: 'SPY', symbol: 'SPY' });
    expect(explicit).toEqual(implicit);
  });

  it('drops exchange when kind is macro (macro assets do not carry an exchange)', () => {
    const out = resolveAssetRef({ kind: 'macro', id: 'DGS10', symbol: '10Y', exchange: 'IGNORED' });
    expect(out).toEqual({ kind: 'macro', id: 'DGS10', symbol: '10Y' });
    expect('exchange' in out).toBe(false);
  });
});
```

- [ ] **Step 4: Run the new tests — confirm they pass**

```
npm test -- src/tactical/asset-ref
```

Expected: 5 passing. (Impl from Step 2 already exists when the tests first run; this isn't a strict red→green TDD cycle because we're consolidating already-tested behavior, not designing new behavior.)

- [ ] **Step 5: Update `src/tactical/from-spec.ts`**

Find the local `resolveAsset` block at lines 45-49:

```ts
function resolveAsset(ref: AssetRef): Asset {
  return ref.exchange !== undefined
    ? { kind: 'equity', id: ref.id, symbol: ref.symbol, exchange: ref.exchange }
    : { kind: 'equity', id: ref.id, symbol: ref.symbol };
}
```

Delete it. Add an import near the top of the file (after the existing tactical-internal imports — there is already an `import type { ... } from './types';` line; add a new line right after it):

```ts
import { resolveAssetRef } from './asset-ref';
```

Then `grep -n "resolveAsset" src/tactical/from-spec.ts` to find every reference to the deleted local function and replace each call with `resolveAssetRef`. The two are signature-compatible.

After the edits, `grep -n "resolveAsset" src/tactical/from-spec.ts` should show only `resolveAssetRef` references.

- [ ] **Step 6: Update `src/tactical/synthetics.ts`**

Find the local `resolveAsset` block at lines 5-9 and delete it. Add the import after the existing imports:

```ts
import { resolveAssetRef } from './asset-ref';
```

Then `grep -n "resolveAsset" src/tactical/synthetics.ts` and rename the call site from `resolveAsset(...)` to `resolveAssetRef(...)`.

- [ ] **Step 7: Update `src/tactical/evaluate-feature-specs.ts`**

Find the local `resolveAsset` block at lines 6-10 and delete it. Add:

```ts
import { resolveAssetRef } from './asset-ref';
```

Replace any `resolveAsset(...)` call with `resolveAssetRef(...)`.

- [ ] **Step 8: Confirm no local `resolveAsset` survives**

```
grep -rn "function resolveAsset" src/tactical/
```

Expected: zero output.

```
grep -rn "resolveAsset[^R]" src/tactical/
```

Expected: zero output (i.e. no `resolveAsset(` call sites still using the deleted name).

- [ ] **Step 9: Add a mixed-kind universe test to `src/tactical/from-spec.test.ts`**

Find a spot in the existing `describe('fromSpec', ...)` block. Add this test (the exact import shape and helper functions used elsewhere in the file should be reused — read the file first to match its conventions, especially how it builds a `runtime` and `calendar`):

```ts
it('honors AssetRef.kind by producing a mixed-kind universe', () => {
  const equity: AssetRef = { id: 'us:SPY', symbol: 'SPY' };
  const macro: AssetRef = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };

  const spec: TacticalSpec = {
    kind: 'tactical/v1',
    universe: [equity, macro],
    rebalance: { frequency: 'Monthly' },
    features: [],
    rules: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
  };

  const strategy = fromSpec(spec, { runtime: makeRuntime(), calendar: new NYSEExchangeCalendar() });
  const universe = strategy.universe(new Date('2024-06-03T00:00:00Z'), { cash: 0, positions: [], t: new Date(0) });

  expect(universe).toHaveLength(2);
  expect(universe.find((a) => a.id === 'us:SPY')?.kind).toBe('equity');
  expect(universe.find((a) => a.id === 'DGS10')?.kind).toBe('macro');
});
```

`makeRuntime()` is the existing helper in `from-spec.test.ts`; if it's named differently in the actual file, use the right name. Read the file first to confirm.

If `from-spec.test.ts` doesn't have `makeRuntime` or an equivalent, build a minimal `FeatureRuntime` inline using `MemoryFeatureCache` + a stub `DataFeed` whose `bars` yields no bars (the test doesn't iterate bars; it only needs `strategy.universe` to return).

- [ ] **Step 10: Run the full pipeline**

```
npm test && npm run build && npm run docs:check && npm run lint
```

Expected: all green. The new test in `from-spec.test.ts` passes; the 5 tests in `asset-ref.test.ts` pass; existing tests are unaffected (because the helper preserves equity-default behavior).

- [ ] **Step 11: Commit**

```bash
git add src/tactical/types.ts src/tactical/asset-ref.ts src/tactical/asset-ref.test.ts src/tactical/from-spec.ts src/tactical/synthetics.ts src/tactical/evaluate-feature-specs.ts src/tactical/from-spec.test.ts
git commit -m "feat(tactical): support macro asset kind via AssetRef.kind

Adds optional 'kind' discriminator to AssetRef (default 'equity', backward-compat).
Extracts the triplicated resolveAsset helper into src/tactical/asset-ref.ts so
the resolution rule lives in one place.

Spec: docs/specs/2026-05-03-routing-data-feed-recipe-design.md (Part 1)"
```

---

### Task 2: Add the runnable recipe

**Goal:** A standalone TS script that compiles via `docs:check` and runs end-to-end via `tsx`. It demonstrates a tactical/v1 spec mixing equity and macro assets, composes Yahoo-shaped + FRED-shaped synthetic feeds via `RoutingDataFeed`, and prints a regime-distribution summary so the reader can see the yield gate working.

**Files:**
- Create: `scripts/docs/recipes/composing-data-feeds.ts`

**Acceptance Criteria:**
- [ ] `npx tsx scripts/docs/recipes/composing-data-feeds.ts` runs to completion and prints the regime summary
- [ ] `npm run docs:check` type-checks the new file without errors
- [ ] The script defines `DGS10` with `kind: 'macro' as const` and lists it in the spec's `universe`
- [ ] The script constructs `new RoutingDataFeed({ equity, macro })` and passes it as the `dataFeed` to both `runBacktest` and `FeatureRuntime`
- [ ] At least one rebalance fires for SPY *and* at least one fires for TLT (synthetic DGS10 fixture must cross 4.5% in both directions during the backtest range)

**Verify:** `npx tsx scripts/docs/recipes/composing-data-feeds.ts && npm run docs:check`

**Steps:**

- [ ] **Step 1: Write `scripts/docs/recipes/composing-data-feeds.ts`**

```ts
// Recipe: Composing data feeds with RoutingDataFeed
//
// Tactical/v1 strategies often need data from more than one vendor —
// equity bars from one source (e.g. Yahoo) and macro time series from
// another (e.g. FRED). This recipe shows how to wire them together via
// `RoutingDataFeed`, which dispatches each `bars()` call to the right
// inner feed based on `asset.kind`.
//
// The strategy is a single-yield gate: when the 10-year Treasury yield
// (FRED series DGS10) is above 4.5%, allocate 100% to TLT; otherwise
// 100% to SPY. Rebalance monthly.
//
// In production you'd use:
//   const equity = new YfinanceDataFeed();
//   const macro  = new FredDataFeed({ apiKey: process.env.FRED_API_KEY! });
// This script substitutes hand-written synthetic feeds so it runs offline.
//
//   npx tsx scripts/docs/recipes/composing-data-feeds.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
  RoutingDataFeed,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// --- 1. Assets ------------------------------------------------------------

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const TLT = { id: 'us:TLT', symbol: 'TLT' };
// Macro asset — annotated with `kind: 'macro'` so the dialect resolves it to
// a MacroAsset, and RoutingDataFeed sends it to the macro inner feed.
const DGS10 = { kind: 'macro' as const, id: 'DGS10', symbol: '10Y Treasury' };

// --- 2. Strategy spec -----------------------------------------------------
//
// Rule tree: a single if/else gate on the 10y yield.
//   dgs10_yield > 4.5  →  100% TLT
//   else               →  100% SPY

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, TLT, DGS10],
  rebalance: { frequency: 'Monthly' },
  features: [{ id: 'dgs10_yield', kind: 'price', asset: DGS10 }],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'dgs10_yield' }, right: 4.5 },
    then: { op: 'allocate', weights: { 'us:TLT': 1.0 } },
    else: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
  },
};

// --- 3. Synthetic equity feed --------------------------------------------

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeEquityBars(start: Date, days: number, basePrice: number, drift: number, phase: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin((i + phase) / 12) * 0.006);
    bars.push({ t, open: price, high: price * 1.006, low: price * 0.994, close: price, volume: 800_000 });
  }
  return bars;
}

const EQUITY_FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeEquityBars(utc('2022-01-03'), 900, 450, 0.0004, 0),
  'us:TLT': makeEquityBars(utc('2022-01-03'), 900, 95, -0.0001, 30),
};

const equityFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no equity fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 4. Synthetic macro feed ---------------------------------------------
//
// DGS10 oscillates between roughly 3.8% and 5.0% with a ~6-month cycle.
// Crosses 4.5% in both directions during a 1-year window so the recipe
// shows the yield-gate triggering both branches of the rule tree.

function makeMacroBars(start: Date, days: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    const yieldValue = 4.4 + Math.sin(i / 60) * 0.6;
    bars.push({ t, open: yieldValue, high: yieldValue, low: yieldValue, close: yieldValue, volume: 0 });
  }
  return bars;
}

const MACRO_FIXTURES: Record<string, Bar[]> = {
  DGS10: makeMacroBars(utc('2022-01-03'), 900),
};

const macroFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = MACRO_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no macro fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 5. Compose with RoutingDataFeed --------------------------------------

const dataFeed = new RoutingDataFeed({
  equity: equityFeed,
  macro: macroFeed,
});

// --- 6. Runtime -----------------------------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };
// Give FeatureRuntime the full fixture window so price features have history.
const runtimeRange: DateRange = { from: utc('2022-01-03'), to: utc('2024-08-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    // Only equity assets are ever traded by this strategy.
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no fill fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`composing-data-feeds: no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

// --- 7. Run ---------------------------------------------------------------

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// --- 8. Print summary -----------------------------------------------------

const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const tltSessions = result.snapshots.filter((s) =>
  s.portfolio.positions.some((p) => p.asset.id === 'us:TLT' && p.quantity > 0),
).length;
const spySessions = result.snapshots.filter((s) =>
  s.portfolio.positions.some((p) => p.asset.id === 'us:SPY' && p.quantity > 0),
).length;
const final = result.snapshots.at(-1);
const posValue = (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.quantity * p.basis, 0);
const nav = (final?.portfolio.cash ?? 0) + posValue;

console.log('=== composing-data-feeds recipe ===');
console.log(`sessions      : ${sessions}`);
console.log(`rebalances    : ${rebalances}`);
console.log(`SPY sessions  : ${spySessions}  (yield ≤ 4.5% — risk-on)`);
console.log(`TLT sessions  : ${tltSessions}  (yield > 4.5% — defensive)`);
console.log(`final cash    : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
console.log(`est. nav      : $${nav.toFixed(2)}`);
```

- [ ] **Step 2: Run the script — confirm it executes**

```
npx tsx scripts/docs/recipes/composing-data-feeds.ts
```

Expected: console output along the lines of

```
=== composing-data-feeds recipe ===
sessions      : <about 250>
rebalances    : <about 12>
SPY sessions  : <some>  (yield ≤ 4.5% — risk-on)
TLT sessions  : <some>  (yield > 4.5% — defensive)
final cash    : $...
est. nav      : $...
```

Both `SPY sessions` and `TLT sessions` MUST be > 0 — if either is 0, the synthetic DGS10 fixture didn't cross 4.5% in the backtest window. Tune the macro fixture's amplitude / phase if needed.

- [ ] **Step 3: Type-check via docs:check**

```
npm run docs:check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/docs/recipes/composing-data-feeds.ts
git commit -m "docs(recipe): runnable script for composing data feeds

Synthetic equity + macro feeds composed via RoutingDataFeed, driving a
single-yield-gate tactical/v1 strategy. Type-checks via docs:check and
runs offline via npx tsx.

Spec: docs/specs/2026-05-03-routing-data-feed-recipe-design.md (Part 2)"
```

---

### Task 3: Recipe markdown + sidebar + guide cross-link

**Goal:** Author the recipe page, register it in the docs site sidebar, and add a one-paragraph cross-link from the existing custom-data-feed guide.

**Files:**
- Create: `docs-site/recipes/composing-data-feeds.md`
- Modify: `docs-site/.vitepress/config.ts` (sidebar)
- Modify: `docs-site/guides/runtime/custom-data-feed.md` (one new section near the top)

**Acceptance Criteria:**
- [ ] `docs-site/recipes/composing-data-feeds.md` exists with the structure: hook → strategy → wiring the universe → composing the feeds → production wiring → full code → expected output
- [ ] The recipe's "full code" section embeds the runnable script verbatim
- [ ] The recipe's "expected output" section pastes the actual console output produced by `npx tsx scripts/docs/recipes/composing-data-feeds.ts`
- [ ] `docs-site/.vitepress/config.ts` lists the new recipe under the Recipes sidebar
- [ ] `docs-site/guides/runtime/custom-data-feed.md` has a "Composing multiple feeds" section near the top linking to the recipe and to `RoutingDataFeed`'s API page
- [ ] `npm run docs:check` still passes

**Verify:** `npm run docs:check`

**Steps:**

- [ ] **Step 1: Run the script and capture its output**

```
npx tsx scripts/docs/recipes/composing-data-feeds.ts > /tmp/composing-data-feeds-output.txt
cat /tmp/composing-data-feeds-output.txt
```

Save the output verbatim — you'll paste it into the markdown's "What you should see" section.

- [ ] **Step 2: Read the runnable script content**

```
cat scripts/docs/recipes/composing-data-feeds.ts
```

You'll embed it verbatim into the markdown. Capture the full file contents.

- [ ] **Step 3: Create `docs-site/recipes/composing-data-feeds.md`**

Use this as the template. Replace `<<EXPECTED OUTPUT>>` with the actual captured output from Step 1, and `<<RUNNABLE SCRIPT CONTENTS>>` with the full file content from Step 2.

````markdown
# Composing data feeds

Most tactical strategies need data from more than one vendor — equity bars from one source, macro time series from another, options chains from a third. The SDK's `RoutingDataFeed` lets you compose multiple `DataFeed`s behind a single interface that `runBacktest`, `FeatureRuntime`, and `BacktestExecutor` all accept unchanged.

This recipe builds a yield-gated SPY/TLT switcher driven by FRED's `DGS10` (10-year Treasury yield), demonstrating how a tactical/v1 spec mixes equity and macro asset kinds in a single universe.

## The strategy

```
if dgs10_yield > 4.5  →  100% TLT  (defensive: long bonds when rates are high)
else                  →  100% SPY  (risk-on: long stocks otherwise)
```

Rebalance monthly. One feature: the latest published 10-year yield, read straight from a FRED-shaped `DataFeed` as the close price of a degenerate OHLCV bar.

## Wiring the universe

Tactical/v1 `AssetRef`s carry an optional `kind` discriminator. Without it, every asset defaults to `'equity'` (backward compatible with existing specs). Mark macro assets explicitly:

```ts
const SPY    = { id: 'us:SPY', symbol: 'SPY' };
const TLT    = { id: 'us:TLT', symbol: 'TLT' };
const DGS10  = { kind: 'macro' as const, id: 'DGS10', symbol: '10Y Treasury' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, TLT, DGS10],
  // ...
};
```

The dialect resolves each `AssetRef` to a runtime `Asset`. SPY and TLT become `EquityAsset`; DGS10 becomes `MacroAsset`. The kind survives all the way to the `DataFeed.bars` call, where the router uses it for dispatch.

## Composing the feeds

```ts
import { RoutingDataFeed } from '@livefolio/sdk';

const dataFeed = new RoutingDataFeed({
  equity: equityFeed,   // any DataFeed for equity assets
  macro:  macroFeed,    // any DataFeed for macro assets
});
```

The map keys are `Asset['kind']` discriminants. The router's `bars(asset, range, freq)` looks up `asset.kind` in the map and delegates the call to the matching feed. `RoutingDataFeed` itself implements `DataFeed`, so `runBacktest`, `FeatureRuntime`, and `BacktestExecutor` accept it without modification.

For more advanced routing (e.g. a free vendor for most assets and a paid vendor for an allowlist), the constructor also accepts a function `(asset) => DataFeed | undefined`.

## Production wiring

In a real deployment you swap the synthetic feeds in this recipe for the real vendor adapters. They install side-by-side with the SDK:

```bash
npm install @livefolio/yfinance @livefolio/fred
```

```ts
import { RoutingDataFeed } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';
import { FredDataFeed } from '@livefolio/fred';

const dataFeed = new RoutingDataFeed({
  equity: new YfinanceDataFeed(),
  macro:  new FredDataFeed({ apiKey: process.env.FRED_API_KEY! }),
});
```

`YfinanceDataFeed` reads OHLCV bars from Yahoo Finance for equity assets. `FredDataFeed` reads macro time series from FRED's `series/observations` endpoint and yields each observation as a degenerate OHLCV bar (`open=high=low=close=value`, `volume=0`). Pass the same composed feed everywhere a `DataFeed` is required — the SDK doesn't see the seam.

## Full code

The runnable script lives at `scripts/docs/recipes/composing-data-feeds.ts`. Run it with:

```bash
npx tsx scripts/docs/recipes/composing-data-feeds.ts
```

Synthetic in-memory feeds make the script offline-runnable; in production swap them for `YfinanceDataFeed` and `FredDataFeed` as shown above.

```ts
<<RUNNABLE SCRIPT CONTENTS>>
```

## What you should see

```
<<EXPECTED OUTPUT>>
```

`SPY sessions` is the count of trading days the portfolio held SPY (yield ≤ 4.5%). `TLT sessions` is the count of days it held TLT (yield > 4.5%). The synthetic DGS10 fixture is built to cross 4.5% in both directions during the backtest window so both branches of the rule tree fire.

## Notes

- **Forgetting to register `macro`** in the route map produces `RoutingDataFeedError: no feed registered for asset.kind="macro" (id="DGS10")`. Catch this at construction by listing every kind your spec uses.
- **`MacroAsset` doesn't carry `exchange`.** Adding an `exchange` field to a macro `AssetRef` is silently dropped during resolution; only equity assets propagate it.
- **`fundamentals` and `events`** on the routed feed are forwarded by kind exactly the way `bars` is, but the router does not currently fan out `events()` across multiple feeds. See the API reference for `RoutingDataFeed`.

## See also

- [`RoutingDataFeed` API](/api/classes/RoutingDataFeed)
- [Custom DataFeed](/guides/runtime/custom-data-feed)
- [Anatomy of a TacticalSpec](/guides/authoring/anatomy-of-a-tactical-spec)
````

- [ ] **Step 4: Update `docs-site/.vitepress/config.ts`**

Locate the `'/recipes/': [...]` block in the `sidebar` config (currently around line 67-77). Inside the `items: [...]` array under `text: 'Recipes'`, append:

```ts
{ text: 'Composing data feeds', link: '/recipes/composing-data-feeds' },
```

After the edit, the recipes sidebar block looks like:

```ts
'/recipes/': [
  {
    text: 'Recipes',
    items: [
      { text: 'Replicating a v0.3 strategy', link: '/recipes/v3-replication' },
      { text: 'Multi-asset trend-following', link: '/recipes/multi-asset-trend' },
      { text: 'Mean-reversion with hysteresis', link: '/recipes/mean-reversion' },
      { text: 'Backtest with realistic slippage', link: '/recipes/realistic-slippage' },
      { text: 'Replay-then-stream (live)', link: '/recipes/replay-then-stream' },
      { text: 'Composing data feeds', link: '/recipes/composing-data-feeds' },
    ],
  },
],
```

- [ ] **Step 5: Update `docs-site/guides/runtime/custom-data-feed.md`**

Read the file first to find the right spot. The existing structure starts with an introduction, then `## Contract`. Add a new `## Composing multiple feeds` section between the introduction (which ends after "...whether that is Yahoo Finance, a broker API, a CSV file, or an in-memory fixture.") and the `## Contract` heading.

Insert this section:

```markdown
## Composing multiple feeds

You don't always have one vendor for everything. A single tactical strategy might pull equity bars from Yahoo, macro time series from FRED, and (eventually) options chains from a third source. The SDK ships a reference [`RoutingDataFeed`](/api/classes/RoutingDataFeed) that dispatches each `bars()` call to the right inner feed based on `asset.kind`:

```ts
import { RoutingDataFeed } from '@livefolio/sdk';

const feed = new RoutingDataFeed({
  equity: new YfinanceDataFeed(),
  macro:  new FredDataFeed({ apiKey: process.env.FRED_API_KEY! }),
});
```

`RoutingDataFeed` itself implements `DataFeed`, so the rest of the runtime sees it as a regular feed. See the [Composing data feeds](/recipes/composing-data-feeds) recipe for an end-to-end example with a tactical/v1 spec.
```

- [ ] **Step 6: Verify**

```
npm run docs:check
```

Expected: clean.

If your docs site has a build script (e.g. `npm run docs:build` or similar), running it locally is a useful extra check but not required for `docs:check` to pass.

- [ ] **Step 7: Commit**

```bash
git add docs-site/recipes/composing-data-feeds.md docs-site/.vitepress/config.ts docs-site/guides/runtime/custom-data-feed.md
git commit -m "docs(recipe): add Composing data feeds recipe + cross-links

Recipe markdown narrates the runnable script, shows production wiring with
@livefolio/yfinance + @livefolio/fred, and registers in the sidebar. The
custom-data-feed guide gains a one-paragraph pointer to the recipe.

Spec: docs/specs/2026-05-03-routing-data-feed-recipe-design.md (Parts 3-4)"
```

---

## Out of scope for this plan

- The `@livefolio/yfinance` and `@livefolio/fred` packages are not added as devDeps of `@livefolio/sdk`. The recipe markdown shows the production wiring as code blocks; the runnable uses synthetic feeds.
- TypeDoc-rendered API page customization for `AssetRef` — the JSDoc on the new `kind` field flows through automatically.
- A separate "Tactical for macro strategies" guide page — YAGNI; the recipe + the existing TacticalSpec guide cover it.
- A live-FRED variant of the runnable. Adding it would require either committing a key (no) or skipping the script in `docs:check` when the key is absent (added complexity, marginal value).
- Other asset kinds (`'futures'`, `'option'`, `'crypto'`) — they ship when their adapters do.
