import type { Asset, AssetId, Bar } from '../interfaces/types';
import type { StreamingDataFeed } from '../interfaces/streaming-data-feed';
import type { Executor } from '../interfaces/executor';
import type { Calendar } from '../interfaces/calendar';
import type { Order } from '../orders/types';
import type { Portfolio } from '../portfolio/types';
import type { Strategy, Features } from './types';
import type { BacktestResult, BacktestSnapshot } from './run-backtest';
import { isStateResult } from './run-backtest';
import { FeatureRuntime } from '../features/runtime';
import { MemoryFeatureCache } from '../reference/memory-feature-cache';
import { applyFills } from '../portfolio/apply';

/**
 * Unified event stream from {@link runLive}. Discriminated union of two variants:
 *
 * - **`mark`** — emitted per tick. The strategy is run in PREVIEW mode (state
 *   is snapshot/restored, no executor call, no portfolio commit). Use this to
 *   render the wiggling rightmost chart point and the "if the session ended now,
 *   the strategy would do X" preview UX.
 * - **`snapshot`** — emitted when a tick crosses a session boundary. The
 *   just-closed bar is finalized, `strategy.build` runs for real, orders are
 *   submitted to the executor, fills are applied, and state advances. Same
 *   shape as {@link BacktestSnapshot} from {@link runBacktest} (plus the
 *   `type: 'snapshot'` discriminant), so consumers can append snapshot events
 *   to the same chart array used by historical results.
 */
export type LiveEvent<F extends Features = Features, _S = unknown> =
  | {
      type: 'mark';
      /** Wall-clock arrival time of this tick. */
      t: Date;
      /** Portfolio at the start of the current session — unchanged by the preview. */
      portfolio: Portfolio;
      /**
       * Per-asset accumulating close so far in the current session. Only assets
       * that have received at least one tick this session appear in the map.
       */
      prices: ReadonlyMap<AssetId, number>;
      /** Features recomputed for the in-progress session. */
      features: F;
      /**
       * Orders the strategy would emit if the session closed at the current
       * tick price. Computed from a state SNAPSHOT — the returned `state` value
       * is discarded, so no committed state is mutated.
       */
      previewOrders: ReadonlyArray<Order>;
      /**
       * Best-effort placeholder — returns the unchanged portfolio. A future
       * `simulateFills(orders, prices)` helper will compute the hypothetical
       * post-rebalance NAV that would result from applying `previewOrders` at
       * `prices`. Until then, consumers compute NAV themselves from
       * `portfolio` + `prices`.
       */
      previewPortfolio: Portfolio;
    }
  | (BacktestSnapshot & { type: 'snapshot' });

/** Required inputs to {@link runLive}. */
export type RunLiveOptions<F extends Features = Features, S = unknown> = {
  /** The strategy to drive. Should already be wired to a streaming-mode
   *  `FeatureRuntime` if its `features` method depends on one. */
  strategy: Strategy<F, S>;
  /**
   * Result of a prior {@link runBacktest} call. Provides the seed `portfolio`,
   * `state`, and `bars` map for the streaming runtime.
   */
  history: BacktestResult<S>;
  /** Source of streaming ticks. */
  dataFeed: StreamingDataFeed;
  /** Order router used at session boundaries to settle the just-closed bar. */
  executor: Executor;
  /** Calendar that resolves a tick's wall-clock time into its session date. */
  calendar: Calendar;
};

/**
 * Returns a structurally equivalent copy of `state` so previews cannot mutate
 * the committed state value. Uses `structuredClone` when available (Node ≥17),
 * falling back to JSON round-trip for older runtimes.
 */
function snapshotState<S>(state: S | undefined): S | undefined {
  if (state === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(state);
  return JSON.parse(JSON.stringify(state)) as S;
}

/**
 * Returns the midnight-UTC `Date` for the day containing `d`. Used as the
 * canonical session key throughout `runLive` — two ticks belong to the same
 * session iff their midnight-UTC dates are equal.
 */
function midnightUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Drives a {@link Strategy} against a streaming market-data source and yields
 * a unified event stream that consumer charts can append to historical
 * snapshots without code branching.
 *
 * **Lifecycle on each tick:**
 * 1. Compute the tick's session date (midnight UTC).
 * 2. If the tick crosses a session boundary, finalize the just-closed bar:
 *    append it to the streaming `FeatureRuntime`, run `strategy.build` for
 *    REAL (committing state), submit orders to the executor, apply fills,
 *    and yield a `snapshot` event identical in shape to {@link BacktestSnapshot}.
 * 3. Record the tick into the current session's accumulating bar.
 * 4. Re-run `strategy.features` and `strategy.build` in PREVIEW mode (state
 *    is snapshot/restored — committed state is untouched). Yield a `mark`
 *    event with the recomputed features and preview orders.
 *
 * **State semantics:** preview-build always operates on a deep clone of the
 * committed `state`. Only the boundary-crossing commit branch advances
 * committed state. This guarantees that 1000 ticks within a single session
 * produce 1000 marks but leave `state` exactly where the prior session-close
 * commit left it.
 *
 * **Bar lineage:** the streaming `FeatureRuntime` is seeded from
 * `history.bars`, so indicators with warmup periods (SMA(200), etc.) work on
 * the first live tick.
 *
 * **Universe:** captured once at startup from `strategy.universe(now, portfolio)`.
 * Dynamic universes are not yet supported in live mode.
 *
 * **Termination:** the iterable terminates when the underlying
 * `StreamingDataFeed.subscribe` iterable terminates. Real adapters yield
 * forever; tests use bounded iterables to assert specific event sequences.
 *
 * @param opts - Live-runtime configuration. See {@link RunLiveOptions}.
 * @returns An open-ended `AsyncIterable<LiveEvent>`. Consumers `for await` the
 *   stream and dispatch on `ev.type`.
 *
 * @example
 * ```ts
 * for await (const ev of runLive({ strategy, history, dataFeed, executor, calendar })) {
 *   if (ev.type === 'mark') {
 *     chart.updateLastBar({ t: ev.t, prices: ev.prices, previewOrders: ev.previewOrders });
 *   } else {
 *     chart.appendBar(ev); // BacktestSnapshot-shaped
 *   }
 * }
 * ```
 */
export async function* runLive<F extends Features = Features, S = unknown>(
  opts: RunLiveOptions<F, S>,
): AsyncIterable<LiveEvent<F, S>> {
  const { strategy, history, dataFeed, executor, calendar: _calendar } = opts;

  // Seed a streaming FeatureRuntime from the historical bars. Strategies that
  // depend on a captured runtime should already be wired to one — this
  // instance is constructed for any strategy whose `features` method consults
  // `runLive`'s buffer directly (rare; documented in the recipe).
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({
    mode: 'streaming',
    featureCache,
    freq: '1d',
    initialBars: history.bars,
  });
  // Reference so the `runtime` is not flagged as unused. Strategies that wrap
  // a different runtime won't read from this one — it exists so future
  // refinements (auto-wiring) have a target instance.
  void runtime;

  let portfolio = history.finalPortfolio;
  let state: S | undefined = history.finalState;
  const universe = strategy.universe(new Date(), portfolio);

  // Track the current session being accumulated. Initialize from the last
  // historical snapshot if present, else lazily from the first tick.
  let currentSession: Date | null =
    history.snapshots.length > 0 ? history.snapshots[history.snapshots.length - 1]!.t : null;
  let currentBarOpen = new Map<AssetId, number>();
  let currentBarHigh = new Map<AssetId, number>();
  let currentBarLow = new Map<AssetId, number>();
  let currentBarClose = new Map<AssetId, number>();

  function recordTick(asset: Asset, tickBar: Bar): void {
    const id = asset.id;
    const price = tickBar.close;
    if (!currentBarOpen.has(id)) currentBarOpen.set(id, price);
    currentBarHigh.set(id, Math.max(currentBarHigh.get(id) ?? -Infinity, price));
    currentBarLow.set(id, Math.min(currentBarLow.get(id) ?? Infinity, price));
    currentBarClose.set(id, price);
  }

  function finalizeBars(sessionDate: Date): void {
    for (const asset of universe) {
      const close = currentBarClose.get(asset.id);
      if (close === undefined) continue;
      runtime.appendBar(asset, {
        t: sessionDate,
        open: currentBarOpen.get(asset.id)!,
        high: currentBarHigh.get(asset.id)!,
        low: currentBarLow.get(asset.id)!,
        close,
        volume: 0,
      });
    }
    currentBarOpen = new Map();
    currentBarHigh = new Map();
    currentBarLow = new Map();
    currentBarClose = new Map();
  }

  for await (const tick of dataFeed.subscribe(universe)) {
    const tickSession = midnightUtc(tick.bar.t);

    if (currentSession === null) {
      currentSession = tickSession;
    }

    // Boundary crossed: finalize the previous session's bar, run REAL build,
    // submit orders, apply fills, yield snapshot, then start the new session.
    if (tickSession.getTime() > currentSession.getTime()) {
      finalizeBars(currentSession);
      const sessionFeatures = await strategy.features(universe, portfolio, currentSession);
      const buildResult = strategy.build(sessionFeatures, portfolio, state as S, currentSession);
      let orders: ReadonlyArray<Order>;
      if (isStateResult(buildResult)) {
        orders = buildResult.orders;
        state = buildResult.state;
      } else {
        orders = buildResult;
      }
      const fills = await executor.submit(orders, currentSession, portfolio);
      portfolio = applyFills(portfolio, fills, orders);
      yield {
        type: 'snapshot',
        t: currentSession,
        portfolio,
        orders,
        fills,
      };
      currentSession = tickSession;
    }

    // Record the tick into the current session's accumulating bar.
    recordTick(tick.asset, tick.bar);

    // Preview: snapshot state, recompute features, run build with the snapshot,
    // discard the returned state. Committed `state` is never touched here.
    const prices = new Map(currentBarClose);
    const features = await strategy.features(universe, portfolio, tick.bar.t);
    const previewState = snapshotState(state);
    const previewResult = strategy.build(features, portfolio, previewState as S, tick.bar.t);
    const previewOrders: ReadonlyArray<Order> = isStateResult(previewResult) ? previewResult.orders : previewResult;

    yield {
      type: 'mark',
      t: tick.bar.t,
      portfolio,
      prices,
      features,
      // TODO: replace with `simulateFills(previewOrders, prices)` when the
      // helper lands so consumers see the hypothetical post-rebalance NAV.
      previewOrders,
      previewPortfolio: portfolio,
    };
  }
}
