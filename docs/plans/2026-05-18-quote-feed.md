# QuoteFeed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `QuoteFeed` interface — a third sibling to `DataFeed` and `StreamingDataFeed` — covering the one-shot pull-quote use case (UI refresh, pre-trade sizing, ad-hoc CLI). Pure type surface; no reference impl, no runtime wiring.

**Architecture:** Add `src/interfaces/quote-feed.ts` declaring `Quote` (an object with `t`, `price`, optional `bid`/`ask`/`currency`) and `QuoteFeed` (`quote(asset)` required, `quoteBatch(assets)` optional). Re-export through `src/interfaces/index.ts` and `src/index.ts`. A small structural test mirrors the `StreamingDataFeed` test pattern. Zero changes to `runBacktest`, `runLive`, `FeatureRuntime`, or any other runtime — `QuoteFeed` is an app-side seam consumers reach for explicitly.

**Tech Stack:** TypeScript (strict, ESM), Vitest, tsup. Companion spec: `docs/specs/2026-05-18-quote-feed-design.md`.

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `src/interfaces/quote-feed.ts` | Create | `Quote` type + `QuoteFeed` interface |
| `src/interfaces/quote-feed.test.ts` | Create | Structural conformance test (mirrors `streaming-data-feed.test.ts`) |
| `src/interfaces/index.ts` | Modify | Re-export `Quote` and `QuoteFeed` |
| `src/index.ts` | Modify | Re-export `Quote` and `QuoteFeed` from the public surface |
| `src/interfaces/AGENTS.md` | Modify | Add `quote-feed.ts` to the Key Files table; refresh the sibling-interfaces note |

---

### Task 1: Add the `QuoteFeed` interface + `Quote` type (TDD)

**Goal:** Declare the interface and prove a mock satisfies it. Mirrors how `StreamingDataFeed` was introduced — a small structural test in the same directory, no runtime code under test.

**Files:**
- Create: `src/interfaces/quote-feed.ts`
- Create: `src/interfaces/quote-feed.test.ts`

**Acceptance Criteria:**
- [ ] `QuoteFeed` requires `quote(asset: Asset): Promise<Quote>` and exposes an optional `quoteBatch(assets): Promise<ReadonlyArray<Quote>>`
- [ ] `Quote` carries `asset`, `t: Date`, `price: number`, optional `bid`, `ask`, `currency`
- [ ] A mock with only `quote` satisfies the interface (no batch required)
- [ ] A mock with both `quote` and `quoteBatch` satisfies the interface
- [ ] `npm test -- src/interfaces/quote-feed` passes
- [ ] `npm run lint` clean

**Verify:** `npm test -- src/interfaces/quote-feed && npm run lint` → green

**Steps:**

- [ ] **Step 1: Write the test first (red)**

Create `src/interfaces/quote-feed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Quote, QuoteFeed } from './quote-feed';
import type { Asset } from './types';

const aapl: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };

describe('QuoteFeed interface', () => {
  it('a mock with only quote() satisfies the interface', async () => {
    const feed: QuoteFeed = {
      async quote(asset) {
        return { asset, t: new Date('2024-06-03T13:30:00Z'), price: 195.12 };
      },
    };

    const q = await feed.quote(aapl);
    expect(q.asset.id).toBe('AAPL');
    expect(q.price).toBe(195.12);
    expect(feed.quoteBatch).toBeUndefined();
  });

  it('a mock with quote() and quoteBatch() satisfies the interface', async () => {
    const feed: QuoteFeed = {
      async quote(asset) {
        return { asset, t: new Date('2024-06-03T13:30:00Z'), price: 100 };
      },
      async quoteBatch(assets) {
        return assets.map((asset) => ({
          asset,
          t: new Date('2024-06-03T13:30:00Z'),
          price: 100,
          bid: 99.99,
          ask: 100.01,
        }));
      },
    };

    const out = await feed.quoteBatch!([aapl]);
    expect(out).toHaveLength(1);
    expect(out[0]?.bid).toBe(99.99);
    expect(out[0]?.ask).toBe(100.01);
  });

  it('Quote carries optional currency without requiring it', () => {
    const minimal: Quote = { asset: aapl, t: new Date(), price: 1 };
    const withCurrency: Quote = { asset: aapl, t: new Date(), price: 1, currency: 'USD' };
    expect(minimal.currency).toBeUndefined();
    expect(withCurrency.currency).toBe('USD');
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail**

Run: `npm test -- src/interfaces/quote-feed`
Expected: failure resolving `./quote-feed` (module does not exist yet).

- [ ] **Step 3: Implement `quote-feed.ts` (green)**

Create `src/interfaces/quote-feed.ts`:

```ts
import type { Asset } from './types';

/**
 * A point-in-time quote for an asset. The `t` field is the vendor-stamped
 * quote time — callers should treat it as the staleness upper bound, not
 * "now". `price` is the last trade price, or the mid when the vendor only
 * exposes bid/ask. `bid` and `ask` surface Level 1 data when available.
 *
 * @example
 * ```ts
 * import type { Quote } from '@livefolio/sdk';
 *
 * const q: Quote = {
 *   asset:    { kind: 'equity', id: 'AAPL', symbol: 'AAPL' },
 *   t:        new Date('2024-06-03T13:30:00Z'),
 *   price:    195.12,
 *   bid:      195.11,
 *   ask:      195.13,
 *   currency: 'USD',
 * };
 * ```
 */
export type Quote = {
  asset: Asset;
  /** Vendor-stamped quote time. */
  t: Date;
  /** Last trade price, or mid if the vendor only exposes bid/ask. */
  price: number;
  /** Best bid, when the vendor exposes Level 1 data. */
  bid?: number;
  /** Best ask, when the vendor exposes Level 1 data. */
  ask?: number;
  /** Quote currency, when the vendor reports it. */
  currency?: string;
};

/**
 * One-shot current-price source. Sibling interface to {@link DataFeed} and
 * {@link StreamingDataFeed} — they are NOT a union and there is no
 * composition helper. Historical adapters implement `DataFeed.bars()`;
 * streaming adapters implement `StreamingDataFeed.subscribe()`; quote
 * adapters implement `QuoteFeed.quote()`. A vendor that offers all three
 * implements all three interfaces on one class.
 *
 * Implementations MUST guarantee:
 * - `quote` returns a freshly fetched {@link Quote} each call. Implementations
 *   MAY cache for a short TTL to coalesce bursts; cache behavior MUST be
 *   documented on the adapter.
 * - The returned `Quote.t` is the vendor's stamp, not the local clock.
 * - `quote` rejects with a typed error if the asset is unsupported or the
 *   vendor is unreachable. It MUST NOT silently return a stale or fabricated
 *   price.
 *
 * `quoteBatch` is optional. Vendors whose endpoints accept a symbol list
 * SHOULD implement it to avoid N-round-trip storms. Callers feature-detect:
 *
 * ```ts
 * const quotes = feed.quoteBatch
 *   ? await feed.quoteBatch(assets)
 *   : await Promise.all(assets.map(a => feed.quote(a)));
 * ```
 *
 * When `quoteBatch` is implemented, the returned array MUST preserve request
 * order — `quotes[i]` corresponds to `assets[i]`.
 *
 * @example
 * ```ts
 * import type { QuoteFeed } from '@livefolio/sdk';
 *
 * const feed: QuoteFeed = {
 *   async quote(asset) {
 *     return { asset, t: new Date(), price: 195.12 };
 *   },
 * };
 * ```
 */
export interface QuoteFeed {
  /**
   * Returns a freshly fetched quote for `asset`.
   *
   * @param asset - The instrument to quote.
   * @returns A {@link Quote} carrying the vendor-stamped time and price.
   */
  quote(asset: Asset): Promise<Quote>;

  /**
   * Returns quotes for `assets` in a single vendor round-trip. Optional —
   * adapters whose vendor does not expose a batch endpoint may omit this.
   *
   * Returned array MUST preserve request order: `result[i]` corresponds to
   * `assets[i]`.
   *
   * @param assets - The instruments to quote.
   * @returns An array of {@link Quote} objects in request order.
   */
  quoteBatch?(assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>>;
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

Run: `npm test -- src/interfaces/quote-feed`
Expected: 3 passing.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/interfaces/quote-feed.ts src/interfaces/quote-feed.test.ts
git commit -m "feat(interfaces): add QuoteFeed for one-shot pull quotes

Third sibling to DataFeed and StreamingDataFeed. Covers the pull-shaped
use cases (UI refresh, pre-trade sizing, ad-hoc CLI) that neither
existing interface fits. Optional quoteBatch() for vendors with
multi-symbol endpoints.

Spec: docs/specs/2026-05-18-quote-feed-design.md"
```

---

### Task 2: Wire public exports + refresh `src/interfaces/AGENTS.md`

**Goal:** Make `QuoteFeed` and `Quote` importable from `@livefolio/sdk`. Update the interfaces AGENTS.md so future readers find the new file and the sibling-interfaces note covers all three.

**Files:**
- Modify: `src/interfaces/index.ts`
- Modify: `src/index.ts`
- Modify: `src/interfaces/AGENTS.md`

**Acceptance Criteria:**
- [ ] `import type { QuoteFeed, Quote } from '@livefolio/sdk'` works
- [ ] `src/interfaces/AGENTS.md` Key Files table lists `quote-feed.ts`
- [ ] The Common Patterns note that mentions DataFeed/StreamingDataFeed siblings is updated to include `QuoteFeed`
- [ ] `npm run build` succeeds — bundled `dist/index.d.ts` contains both symbols
- [ ] `npm run docs:check` succeeds
- [ ] `npm test` (full suite) passes

**Verify:** `npm run lint && npm test && npm run build && npm run docs:check` → all green

**Steps:**

- [ ] **Step 1: Update `src/interfaces/index.ts`**

Append the new re-export. After Step 1 the file should read:

```ts
export type { Asset, AssetId, EquityAsset, MacroAsset, Bar, DateRange, Frequency, Series } from './types';
export type { DataFeed, Fundamentals, EventKind, DataEvent } from './data-feed';
export type { StreamingDataFeed, StreamingBar } from './streaming-data-feed';
export type { QuoteFeed, Quote } from './quote-feed';
export type { Executor } from './executor';
export type { Calendar, Session, TimeOfDay } from './calendar';
export type { FeatureCache, FeatureKey, FeatureScope } from './feature-cache';
```

- [ ] **Step 2: Update `src/index.ts`**

In the "Interfaces (type surface)" export block (currently lines 16-38), add `QuoteFeed` and `Quote` alongside the streaming types. The block should become:

```ts
// Interfaces (type surface)
export type {
  Asset,
  AssetId,
  EquityAsset,
  MacroAsset,
  Bar,
  DateRange,
  Frequency,
  Series,
  DataFeed,
  Fundamentals,
  EventKind,
  DataEvent,
  StreamingDataFeed,
  StreamingBar,
  QuoteFeed,
  Quote,
  Executor,
  Calendar,
  Session,
  TimeOfDay,
  FeatureCache,
  FeatureKey,
  FeatureScope,
} from './interfaces';
```

- [ ] **Step 3: Update `src/interfaces/AGENTS.md`**

In the Key Files table, add a row directly below `streaming-data-feed.ts`:

```markdown
| `quote-feed.ts` | `QuoteFeed` interface (`quote(asset) → Promise<Quote>`, optional `quoteBatch`) — sibling to `DataFeed` and `StreamingDataFeed`. Covers one-shot pull quotes (UI refresh, pre-trade sizing, ad-hoc CLI). Not consumed by `runBacktest` / `runLive`; app-side seam |
```

In the Common Patterns section, find the bullet:

```markdown
- `StreamingDataFeed` is intentionally NOT a union with `DataFeed` and has NO backward-compat alias — additive sibling interface
```

Replace it with:

```markdown
- `DataFeed`, `StreamingDataFeed`, and `QuoteFeed` are sibling interfaces — NOT a union, NO composition helper, NO backward-compat aliases. Vendors implement whichever subset matches their surface; combined vendors (Alpaca, Polygon) implement all three on one class
```

- [ ] **Step 4: Final verification**

Run: `npm run lint && npm test && npm run build && npm run docs:check`
Expected: all green.

Sanity check the bundle:

Run: `grep -c "QuoteFeed\|Quote" dist/index.d.ts`
Expected: ≥ 2 (the interface re-export and the `Quote` type re-export).

- [ ] **Step 5: Commit**

```bash
git add src/interfaces/index.ts src/index.ts src/interfaces/AGENTS.md
git commit -m "feat(sdk): export QuoteFeed from public surface

Adds QuoteFeed and Quote to the @livefolio/sdk public type surface
alongside the other interfaces. Refreshes the sibling-interfaces note
in src/interfaces/AGENTS.md to cover all three."
```

---

## Out of scope for this plan

- **`latestTickQuoteFeed(streamingFeed)` reference helper** — wraps a `StreamingDataFeed` and serves the latest cached tick per asset as a `QuoteFeed`. Useful for apps that already have a streaming feed and want a pull surface without standing up a second vendor connection. Track as a separate follow-up; the spec already lists it.
- **`RoutingQuoteFeed`** — mirrors `RoutingDataFeed` / `RoutingStreamingDataFeed`. Defer until a second quote-capable vendor lands so the routing surface can be designed against two real adapters, not one.
- **Vendor adapter packages.** Implementing `QuoteFeed` in `@livefolio/yfinance` (if Yahoo's REST quote endpoint is usable) or in the planned Alpaca adapter package is separate work that consumes this interface.
- **Typed error union (`QuoteFeedError`).** Left as an open question in the spec — decide during the first adapter implementation, where the real failure modes will be visible. Adding it later is non-breaking.
- **Runtime wiring.** `runBacktest`, `runLive`, `FeatureRuntime`, `BacktestExecutor`, and `Executor` deliberately do not call `QuoteFeed`. If a future use case (e.g. broker-side fill quote on `Executor`) emerges, that's a separate interface change with its own spec.
- **Docs-site recipe.** A short addition to the custom-adapter recipe explaining the three-interface model belongs with the docs-refresh phase, not this plan.
