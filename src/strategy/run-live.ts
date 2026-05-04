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
  /** The strategy to drive. If its `features` method depends on a captured
   *  `FeatureRuntime` (e.g. tactical strategies built via `fromSpec`), pass the
   *  same runtime instance via {@link RunLiveOptions.streamingRuntime} so the
   *  live bar buffer stays in sync with what the strategy reads. */
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
  /**
   * Optional streaming {@link FeatureRuntime}. Provide this to share the
   * runtime with the strategy — tactical strategies built via `fromSpec`
   * capture a runtime in their `features` closure, so passing the same
   * instance here keeps the live bar buffer in sync with what the strategy
   * reads. When omitted, `runLive` constructs its own streaming runtime
   * seeded from `history.bars`.
   */
  streamingRuntime?: FeatureRuntime;
};

/**
 * Returns a structurally equivalent copy of `state` so previews cannot mutate
 * the committed state value. Uses `structuredClone` (Node ≥20). State must be
 * structured-cloneable — JSON-serializable types plus Date/Map/Set/etc.
 */
function snapshotState<S>(state: S | undefined): S | undefined {
  if (state === undefined) return undefined;
  return structuredClone(state);
}

/**
 * Returns the trading-day key (midnight UTC) for the session containing
 * instant `t`, as resolved by the supplied {@link Calendar}. Two ticks belong
 * to the same session iff `findSession(t1) === findSession(t2)`.
 *
 * Uses `calendar.next(t)` to find the next trading day strictly after `t`,
 * then `calendar.previous` to back-anchor to the session that contains `t`.
 * For NYSE: a tick at Friday 17:00 ET (after-close) has `next` = Monday and
 * `previous(Monday)` = Friday — the correct session anchor.
 */
function findSession(t: Date, calendar: Calendar): Date {
  const next = calendar.next(t);
  return calendar.previous(next);
}

/**
 * Drives a {@link Strategy} against a streaming market-data source and yields
 * a unified event stream that consumer charts can append to historical
 * snapshots without code branching.
 *
 * **Lifecycle on each tick:**
 * 1. Resolve the tick's session date via the supplied {@link Calendar} —
 *    `calendar.previous(calendar.next(tick.t))`. This correctly handles
 *    after-hours ticks (NYSE 17:00 ET stays in the same session) and DST
 *    transitions.
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
 * **FeatureRuntime:** if the strategy was built via `fromSpec` it captures its
 * own runtime in the `features` closure. Pass that same instance via
 * {@link RunLiveOptions.streamingRuntime} so `appendBar` calls land on the
 * runtime the strategy actually reads. When omitted, `runLive` constructs its
 * own streaming runtime seeded from `history.bars` — this works for hand-rolled
 * strategies whose `features` method consults the runtime directly, but it
 * leaves a `fromSpec` strategy reading a stale captured runtime.
 *
 * **Bar lineage:** the streaming `FeatureRuntime` (provided or constructed) is
 * seeded from `history.bars`, so indicators with warmup periods (SMA(200),
 * etc.) work on the first live tick.
 *
 * **Universe:** captured once at startup from
 * `strategy.universe(anchorTime, portfolio)`, where `anchorTime` is the last
 * historical snapshot's timestamp (or epoch zero for empty history). Dynamic
 * universes are not yet supported in live mode.
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
  const { strategy, history, dataFeed, executor, calendar } = opts;

  // Streaming FeatureRuntime: prefer a caller-supplied instance (so `fromSpec`
  // strategies that captured a runtime keep reading the same buffer we append
  // to). Otherwise build one seeded from `history.bars` for hand-rolled
  // strategies that consult the runtime directly.
  const runtime =
    opts.streamingRuntime ??
    new FeatureRuntime({
      mode: 'streaming',
      featureCache: new MemoryFeatureCache(),
      freq: '1d',
      initialBars: history.bars,
    });

  let portfolio = history.finalPortfolio;
  let state: S | undefined = history.finalState;
  // Universe is captured once at startup using the last historical snapshot's
  // timestamp as an anchor (or epoch zero for empty history). Dynamic
  // universes are not yet supported in live mode.
  const anchorTime = history.snapshots.length > 0 ? history.snapshots[history.snapshots.length - 1]!.t : new Date(0);
  const universe = strategy.universe(anchorTime, portfolio);

  // Track the current session being accumulated. When history is non-empty,
  // its last snapshot represents an already-committed session, so the next
  // session to accumulate is `calendar.next(lastSnapshot.t)`. Without this
  // advance, the first live tick whose session exceeds `lastSnapshot.t` would
  // re-fire the boundary and emit a duplicate snapshot for the already-closed
  // session. With empty history, we lazily adopt the first tick's session.
  let currentSession: Date | null =
    history.snapshots.length > 0 ? calendar.next(history.snapshots[history.snapshots.length - 1]!.t) : null;
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
    const tickSession = findSession(tick.bar.t, calendar);

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

    // Wiggle: push the in-flight session bar into the streaming runtime so
    // feature computations see the running close. `runtime.appendBar` allows
    // same-t replacement, so subsequent ticks within the session overwrite
    // the in-flight bar in place. Without this step, features would be
    // pinned to yesterday's close — preview decisions would be stable
    // through the session and only refresh at session-close finalization,
    // which contradicts the model that every tick is "as if the session
    // closed at this price."
    for (const asset of universe) {
      const close = currentBarClose.get(asset.id);
      if (close === undefined) continue;
      runtime.appendBar(asset, {
        t: currentSession,
        open: currentBarOpen.get(asset.id)!,
        high: currentBarHigh.get(asset.id)!,
        low: currentBarLow.get(asset.id)!,
        close,
        volume: 0,
      });
    }

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
