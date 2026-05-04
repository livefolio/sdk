# Routing-streaming + polling adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two tested reference impls so v0.4 strategies can compose multiple `StreamingDataFeed` sources for live runs (equity push + macro polling). Land both pieces in the same plan because they're co-designed and the macro slot of the typical routed setup is the polling adapter.

**Architecture:** Mirror the historical-side `RoutingDataFeed` pattern: a sibling class (`RoutingStreamingDataFeed`) that fans `subscribe()` per route and merges with k-way async-iterable merge. Pair it with a generic `pollingStreamFromHistorical(opts)` factory that wraps any `DataFeed` as a `StreamingDataFeed` via scheduled REST polls + per-asset `lastSeenT` deduplication. Zero changes to existing runtime entry points (`runBacktest`, `runLive`, `fromSpec`, `FeatureRuntime`).

**Tech Stack:** TypeScript (strict, ESM), Vitest, tsup. Companion spec: `docs/specs/2026-05-03-routing-streaming-and-polling-design.md`.

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `src/reference/routing-streaming-data-feed.ts` | Create | `RoutingStreamingDataFeed` class + error + types |
| `src/reference/routing-streaming-data-feed.test.ts` | Create | Co-located unit tests (10 cases) |
| `src/reference/polling-stream-from-historical.ts` | Create | `pollingStreamFromHistorical` factory + types |
| `src/reference/polling-stream-from-historical.test.ts` | Create | Co-located unit tests (10 cases) |
| `src/reference/index.ts` | Modify | Re-export the new symbols |
| `src/index.ts` | Modify | Public re-exports |
| `src/reference/AGENTS.md` | Modify | Add the new reference impls to the Key Files table |
| `docs-site/recipes/composing-streaming-data-feeds.md` | Create | Live counterpart of the historical Composing-data-feeds recipe |
| `scripts/docs/recipes/composing-streaming-data-feeds.ts` | Create | Runnable script — finite tick source so `docs:check` terminates |
| `docs-site/.vitepress/config.ts` | Modify | Add the new recipe to the Recipes sidebar |
| `docs-site/recipes/composing-data-feeds.md` | Modify | Cross-link to the new live recipe |
| `docs-site/recipes/replay-then-stream.md` | Modify | Cross-link to the new multi-source live recipe |

---

### Task 1: Implement `RoutingStreamingDataFeed` (TDD)

**Goal:** Ship a `StreamingDataFeed`-shaped router that mirrors `RoutingDataFeed` and merges per-route subscriptions via k-way async-iterable merge.

**Files:**
- Create: `src/reference/routing-streaming-data-feed.ts`
- Create: `src/reference/routing-streaming-data-feed.test.ts`

**Acceptance Criteria:**
- [ ] `RoutingStreamingDataFeed implements StreamingDataFeed` with constructor accepting `Partial<Record<Asset['kind'], StreamingDataFeed>>` or `(asset) => StreamingDataFeed | undefined`
- [ ] `subscribe()` groups assets by route, calls each upstream `subscribe()` exactly once with that route's assets
- [ ] Empty `assets` array returns an immediately-done iterable; no upstream calls
- [ ] Per-asset ordering preserved across upstream iterables
- [ ] Upstream errors propagate; surviving upstream iterators are cancelled via `return()`
- [ ] Consumer-side `break` cancels all live upstream iterators via `return()`
- [ ] Unroutable assets surface `RoutingStreamingDataFeedError` on first `next()` (lazy throw matches `RoutingDataFeed.bars()` shape)
- [ ] All 10 test cases pass; `npm run lint` clean

**Verify:** `npm test -- src/reference/routing-streaming-data-feed` → 10 passing

**Steps:**

- [ ] **Step 1: Write the test file first (red).** Create `src/reference/routing-streaming-data-feed.test.ts`. Cover the 10 cases enumerated in the spec's Tests section. Helpers:
  - `makeStream(ticks: ReadonlyArray<StreamingBar>): StreamingDataFeed` — returns a feed whose `subscribe()` yields the given ticks in order (use `vi.fn()` to record subscribe calls).
  - `makeControlledStream(): { feed: StreamingDataFeed; emit: (tick: StreamingBar) => void; finish: () => void; throw: (e: Error) => void; subscribed: () => Asset[]; returnCalls: () => number }` — for tests that need precise interleaving, error injection, or to assert `return()` was called.
  - `drain(it, n)` — collect at most `n` ticks then `break`.

  Run `npm test -- src/reference/routing-streaming-data-feed`. Expected: failure resolving `./routing-streaming-data-feed`.

- [ ] **Step 2: Implement `routing-streaming-data-feed.ts` (green).** Match the spec's Class Shape and Subscribe Behavior sections. Structure:

  ```ts
  import type { Asset } from '../interfaces/types';
  import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';

  export class RoutingStreamingDataFeedError extends Error { /* … */ }

  export type RoutingStreamingDataFeedRouteFn = (asset: Asset) => StreamingDataFeed | undefined;
  export type RoutingStreamingDataFeedRouteMap = Readonly<Partial<Record<Asset['kind'], StreamingDataFeed>>>;

  export class RoutingStreamingDataFeed implements StreamingDataFeed {
    private readonly route: RoutingStreamingDataFeedRouteFn;
    constructor(routes: RoutingStreamingDataFeedRouteMap | RoutingStreamingDataFeedRouteFn) { /* … */ }

    subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
      // Resolve grouping eagerly so unroutable assets fail-fast on first next().
      // Subscribe lazily inside the generator so empty-input returns done immediately.
      return this.merged(assets);
    }

    private async *merged(assets: ReadonlyArray<Asset>): AsyncGenerator<StreamingBar> {
      if (assets.length === 0) return;
      // Group by routed feed (reference identity).
      const groups = new Map<StreamingDataFeed, Asset[]>();
      for (const asset of assets) {
        const feed = this.route(asset);
        if (feed === undefined) {
          throw new RoutingStreamingDataFeedError(
            `RoutingStreamingDataFeed: no feed registered for asset.kind="${asset.kind}" (id="${asset.id}")`,
          );
        }
        const list = groups.get(feed) ?? [];
        list.push(asset);
        groups.set(feed, list);
      }
      const iters = [...groups.entries()].map(([feed, group]) =>
        feed.subscribe(group)[Symbol.asyncIterator](),
      );
      yield* mergeIterators(iters);
    }
  }

  async function* mergeIterators(iters: ReadonlyArray<AsyncIterator<StreamingBar>>): AsyncGenerator<StreamingBar> {
    // K-way merge with cleanup on throw / consumer-break.
    // Implementation per spec § "K-way merge implementation".
  }
  ```

  Run `npm test -- src/reference/routing-streaming-data-feed`. Expected: 10 passing.

- [ ] **Step 3: Lint.** `npm run lint`. Expected: clean.

- [ ] **Step 4: Commit.**

  ```bash
  git add src/reference/routing-streaming-data-feed.ts src/reference/routing-streaming-data-feed.test.ts
  git commit -m "feat(reference): add RoutingStreamingDataFeed for multi-source live composition

  Sibling of RoutingDataFeed for the StreamingDataFeed interface. Fans
  subscribe() per routed feed and merges via k-way async-iterable merge
  with consumer-cancel and error-propagation cleanup.

  Spec: docs/specs/2026-05-03-routing-streaming-and-polling-design.md"
  ```

---

### Task 2: Implement `pollingStreamFromHistorical` (TDD)

**Goal:** Ship a generic adapter that turns any `DataFeed` into a `StreamingDataFeed` by polling on a configurable schedule, with per-asset `lastSeenT` deduplication.

**Files:**
- Create: `src/reference/polling-stream-from-historical.ts`
- Create: `src/reference/polling-stream-from-historical.test.ts`

**Acceptance Criteria:**
- [ ] `pollingStreamFromHistorical(opts)` returns a value implementing `StreamingDataFeed`
- [ ] `interval` schedule sleeps `intervalMs` between polls; first poll happens after the initial sleep
- [ ] `session-close` schedule polls at the next `Session.close` strictly after `now()`, resolved via `calendar.schedule({ from: now(), to: now() + N days })` lookahead. (`Calendar.Session` exposes `.close`, not `.end` — the original plan wording referenced a non-existent field; corrected here.)
- [ ] Per-asset `lastSeenT` advances only on bars with strictly greater `t`; equal or earlier `t` are dropped
- [ ] `initialFrom` controls the first poll's `from`; defaults to `new Date(0)`
- [ ] `now` and `sleep` are injectable for tests
- [ ] Empty `assets` returns immediately-done iterable; sleep never called
- [ ] Duplicate asset ids in `assets` are deduplicated at subscribe time
- [ ] All 10 test cases pass; `npm run lint` clean

**Verify:** `npm test -- src/reference/polling-stream-from-historical` → 10 passing

**Steps:**

- [ ] **Step 1: Write the test file first (red).** Create `src/reference/polling-stream-from-historical.test.ts`. Inject `now: () => fixedDate` and `sleep: vi.fn(async () => {})` for deterministic timing. Mock `feed.bars()` to return controlled async generators per call (one per `(asset, range)` invocation).

  Run `npm test -- src/reference/polling-stream-from-historical`. Expected: failure resolving the module.

- [ ] **Step 2: Implement `polling-stream-from-historical.ts` (green).** Structure:

  ```ts
  import type { Asset, AssetId, Bar, Frequency } from '../interfaces/types';
  import type { DataFeed } from '../interfaces/data-feed';
  import type { Calendar } from '../interfaces/calendar';
  import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';

  export type PollingSchedule =
    | { kind: 'interval'; intervalMs: number }
    | { kind: 'session-close'; calendar: Calendar };

  export type PollingStreamOptions = {
    feed: DataFeed;
    freq: Frequency;
    schedule: PollingSchedule;
    initialFrom?: Date;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  };

  export function pollingStreamFromHistorical(opts: PollingStreamOptions): StreamingDataFeed {
    const now = opts.now ?? (() => new Date());
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
    const initialFrom = opts.initialFrom ?? new Date(0);

    return {
      subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
        return poll(assets);
      },
    };

    async function* poll(assets: ReadonlyArray<Asset>): AsyncGenerator<StreamingBar> {
      // Dedup by id, preserve input order.
      const seen = new Set<AssetId>();
      const uniq: Asset[] = [];
      for (const a of assets) if (!seen.has(a.id)) { seen.add(a.id); uniq.push(a); }
      if (uniq.length === 0) return;

      const lastSeenT = new Map<AssetId, Date>(uniq.map((a) => [a.id, initialFrom]));

      while (true) {
        await waitForNextPoll();
        for (const asset of uniq) {
          const from = lastSeenT.get(asset.id)!;
          const to = now();
          for await (const bar of opts.feed.bars(asset, { from, to }, opts.freq)) {
            const last = lastSeenT.get(asset.id)!;
            if (bar.t.getTime() > last.getTime()) {
              yield { asset, bar };
              lastSeenT.set(asset.id, bar.t);
            }
          }
        }
      }
    }

    async function waitForNextPoll(): Promise<void> {
      if (opts.schedule.kind === 'interval') {
        await sleep(opts.schedule.intervalMs);
        return;
      }
      // session-close: probe forward via cal.schedule() with a small lookahead,
      // pick the first session whose .close is strictly after now. If no session
      // lands in the window (exotic calendar / extended holiday), sleep 1 day
      // and let the loop retry — never deadlock.
      const cal = opts.schedule.calendar;
      const t = now();
      const lookaheadDays = 14;
      const sessions = cal.schedule({
        from: t,
        to: new Date(t.getTime() + lookaheadDays * 24 * 60 * 60 * 1000),
      });
      const upcoming = sessions.find((s) => s.close.getTime() > t.getTime());
      if (upcoming === undefined) {
        await sleep(24 * 60 * 60 * 1000);
        return;
      }
      const delay = Math.max(0, upcoming.close.getTime() - t.getTime());
      await sleep(delay);
    }
  }
  ```

  Note: `Calendar.Session` uses `.close` (not `.end`) — confirmed in `src/interfaces/calendar.ts`. The session-close branch resolves via `cal.schedule({ from: now, to: now + 14 days })` and picks the first entry whose `.close > now`.

  Run `npm test -- src/reference/polling-stream-from-historical`. Expected: 10 passing.

- [ ] **Step 3: Lint.** `npm run lint`. Expected: clean.

- [ ] **Step 4: Commit.**

  ```bash
  git add src/reference/polling-stream-from-historical.ts src/reference/polling-stream-from-historical.test.ts
  git commit -m "feat(reference): add pollingStreamFromHistorical adapter

  Wraps any DataFeed as a StreamingDataFeed by polling on a configurable
  schedule (fixed-interval or session-close), with per-asset lastSeenT
  dedup. Designed for the macro slot of a routed live feed (FRED, etc.).

  Spec: docs/specs/2026-05-03-routing-streaming-and-polling-design.md"
  ```

---

### Task 3: Wire public exports + AGENTS.md

**Goal:** Make both new symbols importable from `@livefolio/sdk`. Update `src/reference/AGENTS.md` so future readers find the impls.

**Files:**
- Modify: `src/reference/index.ts`
- Modify: `src/index.ts`
- Modify: `src/reference/AGENTS.md`

**Acceptance Criteria:**
- [ ] `import { RoutingStreamingDataFeed, RoutingStreamingDataFeedError, pollingStreamFromHistorical } from '@livefolio/sdk'` works (verified by build)
- [ ] `src/reference/AGENTS.md` Key Files table lists the new files
- [ ] `npm run build` succeeds — bundled `dist/` includes the symbols
- [ ] `npm run docs:check` succeeds
- [ ] `npm test` passes (full suite)

**Verify:** `npm run lint && npm test && npm run build && npm run docs:check` → all green

**Steps:**

- [ ] **Step 1: Update `src/reference/index.ts`** with the new exports (see spec § Exports for the literal block).

- [ ] **Step 2: Update `src/index.ts`** — add the new symbols to the "Reference implementations" block alongside `RoutingDataFeed`.

- [ ] **Step 3: Update `src/reference/AGENTS.md`** — add two rows to the Key Files table:

  ```markdown
  | `routing-streaming-data-feed.ts` | `RoutingStreamingDataFeed implements StreamingDataFeed` — sibling of `RoutingDataFeed`; merges per-route subscriptions via k-way async merge |
  | `polling-stream-from-historical.ts` | `pollingStreamFromHistorical(opts)` — wraps a `DataFeed` as a `StreamingDataFeed` via scheduled REST polls + per-asset `lastSeenT` dedup |
  ```

- [ ] **Step 4: Final verification.** `npm run lint && npm test && npm run build && npm run docs:check`. Expected: all green.

  Sanity check the bundle:
  ```bash
  grep -c "RoutingStreamingDataFeed" dist/index.d.ts
  grep -c "pollingStreamFromHistorical" dist/index.d.ts
  ```
  Expected: both ≥ 1.

- [ ] **Step 5: Commit.**

  ```bash
  git add src/reference/index.ts src/index.ts src/reference/AGENTS.md
  git commit -m "feat(sdk): export RoutingStreamingDataFeed + pollingStreamFromHistorical

  Adds the streaming-router and polling adapter to the @livefolio/sdk
  public API alongside the existing reference impls."
  ```

---

### Task 4: Docs-site recipe + cross-links

**Goal:** Ship a runnable docs-site recipe (`Composing streaming data feeds`) demonstrating equity-push + macro-poll routed through `RoutingStreamingDataFeed`, and weave it into the existing recipes' cross-links and sidebar.

**Why a new recipe vs. extending `composing-data-feeds.md`:** Each recipe maps to one runnable script under `scripts/docs/recipes/`. The historical recipe demonstrates a `runBacktest` flow; the streaming counterpart needs a `runLive` flow, a finite tick source, and a polling-cadence demo. Mixing both into one file makes the runnable script branch between modes, which obscures both halves. A sibling recipe with a focused script keeps each example legible and `docs:check`-runnable.

**Files:**
- Create: `docs-site/recipes/composing-streaming-data-feeds.md`
- Create: `scripts/docs/recipes/composing-streaming-data-feeds.ts`
- Modify: `docs-site/.vitepress/config.ts` — add Recipes sidebar entry
- Modify: `docs-site/recipes/composing-data-feeds.md` — `## See also` link to the new recipe
- Modify: `docs-site/recipes/replay-then-stream.md` — `## See also` link to the new recipe

**Acceptance Criteria:**
- [ ] New recipe page renders in dev (`npm run docs:dev`) with no broken links
- [ ] Runnable script terminates (finite tick fixture) and exits 0
- [ ] `npm run docs:check` passes — script type-checks against the public API
- [ ] Sidebar lists the new recipe under Recipes
- [ ] Both existing recipes have a See-also link to the new one

**Verify:** `npm run docs:check && npx tsx scripts/docs/recipes/composing-streaming-data-feeds.ts && npm run docs:build` → all green

**Steps:**

- [ ] **Step 1: Draft the recipe markdown.** `docs-site/recipes/composing-streaming-data-feeds.md`. Suggested structure (mirror `composing-data-feeds.md`):
  - **Lede** — frame the problem: backtest used `RoutingDataFeed`, live needs the streaming sibling, and macro vendors don't stream natively.
  - **The strategy** — reuse the SPY/TLT yield-gate from the historical recipe so readers don't context-switch.
  - **Wiring the live feed** — `RoutingStreamingDataFeed({ equity: …, macro: pollingStreamFromHistorical(…) })`. Show both `interval` and `session-close` schedule shapes.
  - **Why the macro slot is polled, not subscribed** — one paragraph explaining the FRED REST cadence vs. equity tick cadence (this is the conceptual payoff; if a reader takes one thing away, it's this).
  - **Production wiring** — same install/import block shape as the historical recipe; swap synthetic feeds for `YfinanceStreamingDataFeed` (or whatever vendor adapter ships) + `pollingStreamFromHistorical(new FredDataFeed(…), …)`.
  - **Full code** — embed the runnable script via `<<<` include or fenced block.
  - **What you should see** — sample output (snapshot/mark events).
  - **See also** — `composing-data-feeds`, `replay-then-stream`.

- [ ] **Step 2: Write the runnable script.** `scripts/docs/recipes/composing-streaming-data-feeds.ts`. Constraints:
  - Finite tick source — bounded synthetic equity ticks + a session-close polling schedule that emits one macro bar per simulated session. The script must terminate so `docs:check` doesn't hang.
  - Inject `now` and `sleep` into `pollingStreamFromHistorical` (the options spec already supports this) so the script runs in milliseconds, not real-time.
  - Reuse the historical recipe's universe (`SPY`, `TLT`, `DGS10`) for narrative continuity.
  - Print snapshot/mark events to stdout in a readable format.

- [ ] **Step 3: Add to the VitePress sidebar.** Edit `docs-site/.vitepress/config.ts` (around line 77-78):

  ```ts
  { text: 'Replay-then-stream (live)', link: '/recipes/replay-then-stream' },
  { text: 'Composing data feeds', link: '/recipes/composing-data-feeds' },
  { text: 'Composing streaming data feeds', link: '/recipes/composing-streaming-data-feeds' },
  ```

- [ ] **Step 4: Cross-link from the two adjacent recipes.**
  - In `docs-site/recipes/composing-data-feeds.md` — under `## See also`, add: `- [Composing streaming data feeds](/recipes/composing-streaming-data-feeds) — the live counterpart of this recipe.`
  - In `docs-site/recipes/replay-then-stream.md` — under `## See also`, add: `- [Composing streaming data feeds](/recipes/composing-streaming-data-feeds) — extend the live runtime to multi-vendor (equity push + macro polling).`

- [ ] **Step 5: Verify.** `npm run docs:check && npx tsx scripts/docs/recipes/composing-streaming-data-feeds.ts && npm run docs:build`. Expected: all green.

- [ ] **Step 6: Commit.**

  ```bash
  git add docs-site/recipes/composing-streaming-data-feeds.md \
          scripts/docs/recipes/composing-streaming-data-feeds.ts \
          docs-site/.vitepress/config.ts \
          docs-site/recipes/composing-data-feeds.md \
          docs-site/recipes/replay-then-stream.md
  git commit -m "docs(recipe): add Composing streaming data feeds recipe

  Live counterpart of the historical Composing-data-feeds recipe. Wires
  RoutingStreamingDataFeed with equity push + macro polling, with the
  same SPY/TLT yield-gate strategy for narrative continuity. Cross-linked
  from the historical and replay-then-stream recipes."
  ```

---

## Out of scope for this plan

- Cross-link updates to `livefolio-tactical-author` and `livefolio-custom-adapter` skills — track separately once vendor adapter packages (`@livefolio/yahoo-stream`, `@livefolio/fred`-streaming) materialize.
- Multi-frequency polling (per-asset `freq`) — non-breaking to add when needed.
- Cron-style schedule — defer until interval and session-close prove insufficient.
- Backoff/retry policy on polling errors — vendor adapter's responsibility, not the generic helper's.
- Vendor adapter packages (`@livefolio/yahoo-stream`, etc.) — separate repos.
