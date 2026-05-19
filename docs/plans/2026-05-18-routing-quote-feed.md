# RoutingQuoteFeed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a tested `RoutingQuoteFeed` reference implementation so v0.4 consumers can compose multiple `QuoteFeed` sources (Alpaca equities + a polling macro adapter, future per-asset-class vendor splits) behind a single `QuoteFeed` interface. Restores the sibling-router symmetry now that all three market-data interfaces exist.

**Architecture:** New class `RoutingQuoteFeed implements QuoteFeed` in `src/reference/`. Constructor accepts a route map (keyed by `Asset['kind']`) or a route function (escape hatch) — same shape as `RoutingDataFeed` and `RoutingStreamingDataFeed`. `quote(asset)` is a one-line dispatch; `quoteBatch(assets)` groups assets by routed feed, dispatches per-bucket in parallel (using inner `quoteBatch` if present, falling back to `Promise.all(quote)` otherwise), and re-collects into a single array preserving request order. Throws `RoutingQuoteFeedError` (named distinctly from sibling errors) on unroutable assets.

**Tech Stack:** TypeScript (strict, ESM), Vitest, tsup. Companion spec: `docs/specs/2026-05-18-routing-quote-feed-design.md`.

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `src/reference/routing-quote-feed.ts` | Create | `RoutingQuoteFeed` class + `RoutingQuoteFeedError` + route-config types |
| `src/reference/routing-quote-feed.test.ts` | Create | Co-located unit tests (10 cases) |
| `src/reference/index.ts` | Modify | Re-export the new class, error, and route-config types |
| `src/index.ts` | Modify | Public re-exports alongside the sibling routers |
| `src/reference/AGENTS.md` | Modify | Add the new reference impl to the Key Files table |

---

### Task 1: Implement `RoutingQuoteFeed` + `RoutingQuoteFeedError` (TDD)

**Goal:** Ship the routing reference impl. Co-located tests cover all ten behavioral guarantees from the spec, including the request-order-preservation contract that's specific to `quoteBatch`.

**Files:**
- Create: `src/reference/routing-quote-feed.ts`
- Create: `src/reference/routing-quote-feed.test.ts`

**Acceptance Criteria:**
- [ ] `RoutingQuoteFeed implements QuoteFeed` with constructor accepting `RoutingQuoteFeedRouteMap | RoutingQuoteFeedRouteFn`
- [ ] `quote()` routes by resolved feed; throws `RoutingQuoteFeedError` when route is `undefined`
- [ ] `quoteBatch()` always defined on the router; preserves request order; falls back to per-asset `quote` when inner feed lacks `quoteBatch`; throws before any inner call on unroutable assets
- [ ] All 10 test cases pass
- [ ] `npm run lint` clean

**Verify:** `npm test -- src/reference/routing-quote-feed` → 10 passing

**Steps:**

- [ ] **Step 1: Write the test file first (red)**

Create `src/reference/routing-quote-feed.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RoutingQuoteFeed, RoutingQuoteFeedError } from './routing-quote-feed';
import type { Asset } from '../interfaces/types';
import type { QuoteFeed, Quote } from '../interfaces/quote-feed';

const aapl: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
const msft: Asset = { kind: 'equity', id: 'MSFT', symbol: 'MSFT' };
const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y' };
const cpi: Asset = { kind: 'macro', id: 'CPIAUCSL', symbol: 'CPI' };

function makeQuoteFeed(overrides: Partial<QuoteFeed> = {}): QuoteFeed {
  return {
    quote: vi.fn(async (asset: Asset): Promise<Quote> => ({
      asset,
      t: new Date('2024-06-03T13:30:00Z'),
      price: 1,
    })),
    ...overrides,
  };
}

function makeBatchQuoteFeed(overrides: Partial<QuoteFeed> = {}): QuoteFeed {
  return {
    quote: vi.fn(async (asset: Asset): Promise<Quote> => ({
      asset,
      t: new Date('2024-06-03T13:30:00Z'),
      price: 1,
    })),
    quoteBatch: vi.fn(async (assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>> =>
      assets.map((asset) => ({ asset, t: new Date('2024-06-03T13:30:00Z'), price: 1 })),
    ),
    ...overrides,
  };
}

describe('RoutingQuoteFeed', () => {
  it('routes quote() by asset.kind via map form', async () => {
    const alpaca = makeQuoteFeed();
    const fred = makeQuoteFeed();
    const router = new RoutingQuoteFeed({ equity: alpaca, macro: fred });

    await router.quote(aapl);
    await router.quote(dgs10);

    expect(alpaca.quote).toHaveBeenCalledWith(aapl);
    expect(fred.quote).toHaveBeenCalledWith(dgs10);
    expect(alpaca.quote).toHaveBeenCalledTimes(1);
    expect(fred.quote).toHaveBeenCalledTimes(1);
  });

  it('routes quote() via function form', async () => {
    const alpaca = makeQuoteFeed();
    const fred = makeQuoteFeed();
    const router = new RoutingQuoteFeed((a) => (a.kind === 'macro' ? fred : alpaca));

    await router.quote(aapl);
    await router.quote(dgs10);

    expect(alpaca.quote).toHaveBeenCalledTimes(1);
    expect(fred.quote).toHaveBeenCalledTimes(1);
  });

  it('quote() throws RoutingQuoteFeedError on unknown asset.kind', async () => {
    const router = new RoutingQuoteFeed({ equity: makeQuoteFeed() });
    await expect(router.quote(dgs10)).rejects.toThrow(RoutingQuoteFeedError);
    await expect(router.quote(dgs10)).rejects.toThrow(/no feed registered.*kind="macro".*id="DGS10"/);
  });

  it('quote() throws when function form returns undefined', async () => {
    const router = new RoutingQuoteFeed(() => undefined);
    await expect(router.quote(aapl)).rejects.toThrow(RoutingQuoteFeedError);
  });

  it('quoteBatch([]) resolves to [] without route lookup', async () => {
    const route = vi.fn();
    const router = new RoutingQuoteFeed(route);
    expect(await router.quoteBatch!([])).toEqual([]);
    expect(route).not.toHaveBeenCalled();
  });

  it('quoteBatch() preserves request order across routes', async () => {
    const alpaca = makeBatchQuoteFeed({
      quoteBatch: vi.fn(async (assets) =>
        assets.map((asset) => ({ asset, t: new Date(), price: 100 })),
      ),
    });
    const fred = makeBatchQuoteFeed({
      quoteBatch: vi.fn(async (assets) =>
        assets.map((asset) => ({ asset, t: new Date(), price: 200 })),
      ),
    });
    const router = new RoutingQuoteFeed({ equity: alpaca, macro: fred });

    const out = await router.quoteBatch!([dgs10, aapl, msft, cpi]);

    expect(out).toHaveLength(4);
    expect(out[0]?.asset.id).toBe('DGS10');
    expect(out[0]?.price).toBe(200);
    expect(out[1]?.asset.id).toBe('AAPL');
    expect(out[1]?.price).toBe(100);
    expect(out[2]?.asset.id).toBe('MSFT');
    expect(out[2]?.price).toBe(100);
    expect(out[3]?.asset.id).toBe('CPIAUCSL');
    expect(out[3]?.price).toBe(200);
  });

  it('quoteBatch() calls each inner feed exactly once with its grouped assets', async () => {
    const alpaca = makeBatchQuoteFeed();
    const fred = makeBatchQuoteFeed();
    const router = new RoutingQuoteFeed({ equity: alpaca, macro: fred });

    await router.quoteBatch!([aapl, dgs10, msft, cpi]);

    expect(alpaca.quoteBatch).toHaveBeenCalledTimes(1);
    expect(alpaca.quoteBatch).toHaveBeenCalledWith([aapl, msft]);
    expect(fred.quoteBatch).toHaveBeenCalledTimes(1);
    expect(fred.quoteBatch).toHaveBeenCalledWith([dgs10, cpi]);
  });

  it('quoteBatch() falls back to Promise.all(quote) when inner feed lacks quoteBatch', async () => {
    const alpaca = makeQuoteFeed(); // no quoteBatch
    const router = new RoutingQuoteFeed({ equity: alpaca });

    const out = await router.quoteBatch!([aapl, msft]);

    expect(out).toHaveLength(2);
    expect(alpaca.quote).toHaveBeenCalledTimes(2);
    expect(alpaca.quote).toHaveBeenNthCalledWith(1, aapl);
    expect(alpaca.quote).toHaveBeenNthCalledWith(2, msft);
  });

  it('quoteBatch() throws before any inner call on unroutable asset', async () => {
    const alpaca = makeBatchQuoteFeed();
    const router = new RoutingQuoteFeed({ equity: alpaca });

    await expect(router.quoteBatch!([aapl, dgs10])).rejects.toThrow(RoutingQuoteFeedError);
    expect(alpaca.quoteBatch).not.toHaveBeenCalled();
    expect(alpaca.quote).not.toHaveBeenCalled();
  });

  it('quoteBatch() propagates inner-feed rejections unchanged', async () => {
    const boom = new Error('vendor down');
    const alpaca = makeBatchQuoteFeed({
      quoteBatch: vi.fn(async () => {
        throw boom;
      }),
    });
    const router = new RoutingQuoteFeed({ equity: alpaca });

    await expect(router.quoteBatch!([aapl])).rejects.toBe(boom);
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail with "module not found"**

Run: `npm test -- src/reference/routing-quote-feed`
Expected: failure resolving `./routing-quote-feed` (module does not exist yet).

- [ ] **Step 3: Implement `routing-quote-feed.ts` (green)**

Create `src/reference/routing-quote-feed.ts`:

```ts
import type { Asset } from '../interfaces/types';
import type { Quote, QuoteFeed } from '../interfaces/quote-feed';

/**
 * Error thrown by {@link RoutingQuoteFeed} when an asset cannot be routed.
 */
export class RoutingQuoteFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingQuoteFeedError';
  }
}

/** Function form of the routing rule. Returns the feed for `asset`, or `undefined` when no feed handles it. */
export type RoutingQuoteFeedRouteFn = (asset: Asset) => QuoteFeed | undefined;

/** Map form of the routing rule. Keys are `Asset['kind']` discriminants. */
export type RoutingQuoteFeedRouteMap = Readonly<Partial<Record<Asset['kind'], QuoteFeed>>>;

/**
 * A {@link QuoteFeed} that delegates each call to one of several underlying
 * feeds based on the asset. Use this to compose vendors — e.g. Alpaca for
 * equity quotes and a polling adapter for macro series — behind a single
 * `QuoteFeed` instance.
 *
 * Routing rules:
 * - **Map form:** `new RoutingQuoteFeed({ equity: alpaca, macro: fredPolling })`.
 *   Keys are `asset.kind` discriminants. The 90% case.
 * - **Function form:** `new RoutingQuoteFeed((a) => a.kind === 'macro' ? fred : alpaca)`.
 *   Use when routing depends on more than `kind` (e.g. allowlists).
 *
 * The router always implements `quoteBatch` — even if some inner feeds lack
 * it, the router falls back to per-asset `quote()` calls within that group,
 * preserving request order across the full result.
 *
 * @example
 * ```ts
 * import { RoutingQuoteFeed } from '@livefolio/sdk';
 *
 * const feed = new RoutingQuoteFeed({ equity: alpacaQuotes, macro: fredQuotes });
 * const quotes = await feed.quoteBatch!([aaplAsset, dgs10Asset, msftAsset]);
 * // quotes[0] is for AAPL, quotes[1] for DGS10, quotes[2] for MSFT — request order preserved.
 * ```
 */
export class RoutingQuoteFeed implements QuoteFeed {
  private readonly route: RoutingQuoteFeedRouteFn;

  constructor(routes: RoutingQuoteFeedRouteMap | RoutingQuoteFeedRouteFn) {
    if (typeof routes === 'function') {
      this.route = routes;
    } else {
      this.route = (asset) => routes[asset.kind];
    }
  }

  async quote(asset: Asset): Promise<Quote> {
    return this.resolve(asset).quote(asset);
  }

  async quoteBatch(assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>> {
    if (assets.length === 0) return [];

    // Group by routed feed, tracking original index so we can re-collect in request order.
    const groups = new Map<QuoteFeed, Array<{ asset: Asset; index: number }>>();
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]!;
      const feed = this.resolve(asset); // throws before any vendor call on unroutable
      const bucket = groups.get(feed) ?? [];
      bucket.push({ asset, index: i });
      groups.set(feed, bucket);
    }

    const output = new Array<Quote>(assets.length);

    await Promise.all(
      [...groups.entries()].map(async ([feed, bucket]) => {
        const bucketAssets = bucket.map((b) => b.asset);
        const results =
          typeof feed.quoteBatch === 'function'
            ? await feed.quoteBatch(bucketAssets)
            : await Promise.all(bucketAssets.map((a) => feed.quote(a)));
        for (let i = 0; i < bucket.length; i++) {
          output[bucket[i]!.index] = results[i]!;
        }
      }),
    );

    return output;
  }

  private resolve(asset: Asset): QuoteFeed {
    const feed = this.route(asset);
    if (feed === undefined) {
      throw new RoutingQuoteFeedError(
        `RoutingQuoteFeed: no feed registered for asset.kind="${asset.kind}" (id="${asset.id}")`,
      );
    }
    return feed;
  }
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

Run: `npm test -- src/reference/routing-quote-feed`
Expected: 10 passing.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/reference/routing-quote-feed.ts src/reference/routing-quote-feed.test.ts
git commit -m "feat(reference): add RoutingQuoteFeed for multi-source QuoteFeed composition

Third sibling router after RoutingDataFeed and RoutingStreamingDataFeed.
Dispatches QuoteFeed calls to inner feeds keyed by asset.kind (map form)
or by a custom routing function. quoteBatch() groups assets by route,
dispatches per-bucket in parallel (using inner quoteBatch if present,
falling back to per-asset quote()), and re-collects preserving request
order.

Spec: docs/specs/2026-05-18-routing-quote-feed-design.md"
```

---

### Task 2: Wire public exports + AGENTS.md

**Goal:** Make `RoutingQuoteFeed` and `RoutingQuoteFeedError` importable from `@livefolio/sdk`. Update `src/reference/AGENTS.md` so future readers find the impl alongside the sibling routers.

**Files:**
- Modify: `src/reference/index.ts`
- Modify: `src/index.ts`
- Modify: `src/reference/AGENTS.md`

**Acceptance Criteria:**
- [ ] `import { RoutingQuoteFeed, RoutingQuoteFeedError } from '@livefolio/sdk'` works
- [ ] `import type { RoutingQuoteFeedRouteFn, RoutingQuoteFeedRouteMap } from '@livefolio/sdk'` works
- [ ] `src/reference/AGENTS.md` Key Files table lists the new file alongside the other two routers
- [ ] `npm run build` succeeds — bundled `dist/index.d.ts` includes the symbols
- [ ] `npm run docs:check` succeeds
- [ ] `npm test` passes (full suite)

**Verify:** `npm run lint && npm test && npm run build && npm run docs:check` → all green

**Steps:**

- [ ] **Step 1: Update `src/reference/index.ts`**

Add the new exports alongside the existing routing re-exports. After Step 1 the file should include:

```ts
export { RoutingQuoteFeed, RoutingQuoteFeedError } from './routing-quote-feed';
export type { RoutingQuoteFeedRouteFn, RoutingQuoteFeedRouteMap } from './routing-quote-feed';
```

(Place these after the `RoutingStreamingDataFeed` re-exports so the three routers are grouped.)

- [ ] **Step 2: Update `src/index.ts`**

Locate the "Reference implementations" block. Add `RoutingQuoteFeed`, `RoutingQuoteFeedError`, `RoutingQuoteFeedRouteFn`, `RoutingQuoteFeedRouteMap` to the existing value and type re-export lists, alongside the other two routers' exports. The block should end up looking like:

```ts
// Reference implementations
export {
  MemoryFeatureCache,
  BacktestExecutor,
  RoutingDataFeed,
  RoutingDataFeedError,
  RoutingStreamingDataFeed,
  RoutingStreamingDataFeedError,
  RoutingQuoteFeed,
  RoutingQuoteFeedError,
  pollingStreamFromHistorical,
} from './reference';
export type {
  BacktestExecutorOptions,
  NextOpenFn,
  RoutingDataFeedRouteFn,
  RoutingDataFeedRouteMap,
  RoutingStreamingDataFeedRouteFn,
  RoutingStreamingDataFeedRouteMap,
  RoutingQuoteFeedRouteFn,
  RoutingQuoteFeedRouteMap,
  PollingStreamOptions,
  PollingSchedule,
} from './reference';
```

- [ ] **Step 3: Update `src/reference/AGENTS.md`**

In the Key Files table, add a row directly below the `routing-streaming-data-feed.ts` row:

```markdown
| `routing-quote-feed.ts` | `RoutingQuoteFeed implements QuoteFeed` — third sibling of `RoutingDataFeed` / `RoutingStreamingDataFeed`. `quote()` is direct dispatch; `quoteBatch()` groups by route, dispatches per-bucket in parallel (falls back to per-asset `quote` when an inner feed lacks `quoteBatch`), re-collects preserving request order. Pairs with `RoutingQuoteFeedError` |
```

- [ ] **Step 4: Final verification**

Run: `npm run lint && npm test && npm run build && npm run docs:check`
Expected: all green.

Sanity check the bundle:

Run: `grep -c "RoutingQuoteFeed" dist/index.d.ts`
Expected: ≥ 2 (the class export and at least one route-config type re-export).

- [ ] **Step 5: Commit**

```bash
git add src/reference/index.ts src/index.ts src/reference/AGENTS.md
git commit -m "feat(sdk): export RoutingQuoteFeed from public surface

Adds RoutingQuoteFeed, RoutingQuoteFeedError, and the route-config
types to the @livefolio/sdk public API alongside the other two
sibling routers."
```

---

## Out of scope for this plan

- **`quoteBatchSettled` partial-results variant.** Defer until a consumer needs it; non-breaking to add later as an optional method.
- **Quote-feed adapter packages** (Alpaca, Yahoo REST, FRED polling-as-quote, etc.). Separate work; consume this router.
- **`latestTickQuoteFeed(streamingFeed)` reference helper.** Still parked from the `QuoteFeed` spec. Orthogonal to routing — it converts a `StreamingDataFeed` into a `QuoteFeed`; routing then composes the result with others.
- **A docs-site recipe.** Track separately; the spec already lists it as follow-up. A short addition to the custom-adapter recipe is more appropriate than a standalone page.
- **Throttling / coalescing decorators** (`coalescingQuoteFeed(feed, { windowMs })`). Out of scope; ships as a separate decorator if a real use case appears.
- **Capability-aware routing** (route by freshness, by latency). Out of scope; routing stays kind-driven for symmetry with the sibling routers.
