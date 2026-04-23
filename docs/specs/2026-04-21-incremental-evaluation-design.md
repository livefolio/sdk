# Incremental Strategy Evaluation — Design

**Status:** Draft
**Date:** 2026-04-21

## Goal

Drive strategy evaluation latency from `O(history)` into millisecond territory for both:
- **Post-close sync** — daily catch-up that appends one bar per series table.
- **Live preview** — `previewAllocation` / `previewLiveState` computed on the fly with live-quote `overrides`.

Historical reads (`strategy.series({from, to})` over stored data) are already fast and not in scope.

## Non-goals

- Historical backfill / correction of stored bars (not supported today; nothing here introduces it either).
- Schema migrations on `signals_series` or `strategies_series` — those layers use existing last-row accessors (`getLastValue`, `getLatestAllocationId`).
- Revisiting the handle API surface — only the internal sync / evaluate paths change.

## Current bottleneck

Today's hot path (`strategy.series()` → `_ensureFresh` → `_sync` → `_evaluate`):

1. `_evaluate` re-maps every signal's stored bars over **all** trading days every time it runs.
2. `signal._sync` range-fetches both underlying indicator series and replays `evaluateSignal` across the returned range.
3. `indicator._sync` for computed types (SMA / RSI / EMA / Return / Volatility / Drawdown) fetches a wide raw-price window and rebuilds the running state from scratch.
4. `indicator.computeAt` sizes its window by `lookback * {1.5 | 5 | 10}` calendar days and recomputes from that window on every call.

Stored series are already written incrementally (via `fromDate` filters), but the *compute pipelines* themselves do not carry forward any state between invocations. `indicators_series.metadata JSONB` exists and is unused.

## Architecture — "checkpoint → next-bar" compute

Each indicator type gains a second computation entry point alongside its existing cold-start function:

- `computeFull(bars, lookback)` — existing full-series function. Used when no checkpoint exists or when the caller explicitly wants a range recompute.
- `computeNext(prev, newRaw, lookback) → { value, state }` — **O(1)** one-bar-forward step given the previous row's `{ value, metadata }` and today's raw input.

The indicator handle chooses between the two at runtime:

- Last stored row has compatible metadata + only N new bars → loop `computeNext` N times.
- No metadata, or first-ever sync → `computeFull` once (bootstrap), parking state on the new tail row so the next call takes the fast path.

Signals and strategies do not need a new computation entry point; their incremental state is already exposed on the storage provider (`getLastValue`, `getLatestAllocationId`). Their `_sync` / `_evaluate` paths are rewritten to consume those as checkpoints instead of re-mapping history.

## Metadata payloads

Persisted per-row on `indicators_series.metadata`, but maintained only on the **current tail row** per indicator (older rows are nulled — see "Storage layer" below).

| Type | Metadata | Size |
|---|---|---|
| `Price`, `VIX`, `VIX3M`, `T3M`…`T30Y` (FRED), calendar types (`Month`, `Day of Week`, `Day of Month`, `Day of Year`) | `null` | 0 |
| `Threshold` | n/a (synthetic, never stored) | — |
| `SMA(N)` | `{ tail: number[N] }` — last N raw values | N floats |
| `Return(N)` | `{ tail: number[N+1] }` — need N-bars-ago | N+1 floats |
| `Volatility(N)` | `{ tail: number[N+1] }` — raw prices, returns derived each step | N+1 floats |
| `Drawdown(N)` | `{ tail: number[N] }` — raw price window | N floats |
| `EMA(N)` | `{ ema: number }` — post-seed only (rows before seed aren't emitted) | 1 float |
| `RSI(N)` | `{ avgGain: number, avgLoss: number, prev: number }` — Wilder's state | 3 floats |

**Why the raw-price tail instead of a running sum?** `computeNext` stays pure, correction is trivial if a past raw bar is ever backfilled, and we avoid the float drift that a running sum / sumSq accumulates over thousands of steps.

**Storage cost.** Because only the tail row carries metadata per indicator, total metadata footprint is `500 indicators × 1 row × ~585 B avg ≈ 300 KB` — negligible vs. the ~500 MB of raw rows + indexes (500 indicators × 14k trading days since 1970).

## Storage layer

### Interface additions (`src/providers/storage.ts`)

`DailyBar` grows an optional `metadata?: unknown` for round-tripping.

```ts
indicators: {
  // existing:
  upsert(identity): Promise<{ id: number }>;
  findOrCreate(identity): Promise<{ id: number }>;
  getSeries(id, range?): Promise<DailyBar[]>;
  getLatestSeriesDate(id): Promise<string | null>;
  getValue(id, date?): Promise<number | null>;

  // updated:
  writeSeries(
    id: number,
    bars: DailyBar[],
    opts?: { metadata?: unknown },
  ): Promise<void>;

  // new:
  getLatestBar(
    id: number,
  ): Promise<{ date: string; value: number; metadata: unknown } | null>;
}
```

### Supabase implementation — `writeSeries` in one transaction

`:new_max_date` = the max `date` in the `bars` batch being written (pre-computed client-side when `opts.metadata` is supplied; no-op when `bars` is empty or `opts.metadata` is absent).

```sql
-- 1. upsert bars (values only)
INSERT INTO indicators_series (indicator_id, date, value) VALUES (...)
  ON CONFLICT (indicator_id, date) DO UPDATE SET value = EXCLUDED.value;

-- 2. park metadata on the new max-date row
UPDATE indicators_series
   SET metadata = :metadata
 WHERE indicator_id = :id AND date = :new_max_date;

-- 3. clear any older metadata row so there's at most one live checkpoint
UPDATE indicators_series
   SET metadata = NULL
 WHERE indicator_id = :id
   AND date < :new_max_date
   AND metadata IS NOT NULL;
```

`getLatestBar` is `ORDER BY date DESC LIMIT 1` — the checkpoint always lives on that row.

Step 3 is safe because `indicators_series` is only written up to `horizon` (`latestClosed − delay`), never into the future. `tradingDays` has future dates but those aren't mirrored into `indicators_series`.

No schema migration required: the `metadata JSONB` column already exists.

## Indicator handle (`src/handles/indicator.ts`)

### `_sync(fromDate, latestClosed)`

Decide incremental vs cold:

- **Incremental.** `fromDate` is set *and* `getLatestBar(id).metadata` is non-null *and* the type is stateful (EMA / RSI / SMA / Return / Volatility / Drawdown). For each new raw bar, loop `computeNext(state, rawBar.value, lookback)`, threading `state` through. Call `writeSeries(newBars, { metadata: finalState })`.
- **Cold.** Anything else. Current full-compute path, but derive the terminal state from the tail of the computed series and pass it as `metadata` so the next call gets the fast path.

Stateless types (`Price`, `VIX`, `T*`, FRED-fetched, calendar) skip the metadata logic and pass `metadata: null`.

### `computeAt(date, overrides)`

- If stateful *and* `getLatestBar(id)` exists *and* its date is the trading day immediately before `date` → resolve today's single raw bar (market | overrides | last-known), call `computeNext` once, return value. No storage write.
- Otherwise fall back to today's bounded-window recompute. This preserves behaviour when the checkpoint is stale (e.g., multi-day gap) or missing (first call for a newly-created indicator).

## Signal handle (`src/handles/signal.ts`)

### `_sync` — single-bar fast path

When exactly one new bar is needed (the common daily catch-up):

1. `indicator1.computeAt(newDate)` and `indicator2.computeAt(newDate)` in parallel.
2. `storage.signals.getLastValue(id)` for the hysteresis `prevBool`.
3. Apply the single-step `evaluateSignal` math inline (same as the hysteresis branches in `SignalHandle.computeAt`). Write one bar.

Multi-bar catch-up (signal is behind by more than one trading day) → fall back to the current range-based path.

## Strategy handle (`src/handles/strategy.ts`)

### `_evaluate(limitDate, overrides)` — checkpointed

1. `lastDate = storage.strategies.getLatestSeriesDate(id)`.
2. `lastAllocId = storage.strategies.getLatestAllocationId(id)`.
3. `newDays = tradingDays.filter(d => d > lastDate && d <= limitDate)` (empty on cached reads; usually 1 for daily catch-up; ≤ a small N if offline). "Day after" throughout this section means the next *trading* day, taken from `tradingDays` — not a calendar-day arithmetic.
4. For each signal, fetch only `signal.getSeries({ from: newDays[0], to: limitDate })` (typically a single-row query). Preview path splices `signal.computeAt(limitDate, overrides)` at `limitDate`.
5. Reuse `computeRebalanceDates(tradingDays, freq, offset)` — already `O(tradingDays)`, negligible.
6. Walk `newDays` with `current = lastAllocId` as seed; on rebalance dates apply rule evaluation; otherwise carry forward `current`. Emit entries for `newDays` only.

Post-close: upsert the new entries. Preview: return them spliced with stored history; no write.

When `lastDate` is null (first-ever evaluate for this strategy), run the existing full-history evaluate once as bootstrap; subsequent calls take the incremental path.

## Verification

### Property tests — `computeNext` parity

For each stateful type: generate a random raw price series of length `2·N + 50`. Assert that `computeFull(bars, N)[i]` equals the `i`th step of replaying `computeNext` starting from a checkpoint at index `N − 1`. Also assert state continuity: freshly seeded vs replayed produce byte-identical continuations.

### Cold → incremental parity integration test

For each stateful type:

1. Populate full series via cold path.
2. Delete last K rows from `indicators_series`.
3. Re-sync (triggers incremental path).
4. Assert byte-identical series to step 1.

Repeat at the signal and strategy layers (delete last K rows from `signals_series` / `strategies_series` → assert re-sync matches).

### Benchmark

Steady-state `previewAllocation` on a realistic 10-indicator strategy over ~15k trading days should land under ~50 ms (measured target; trend line more important than the exact number). Measure before/after at each phase so we can attribute savings.

## Phase order

Each phase is independently testable and reversible.

1. **Computation layer** — add `*Next` for each stateful type, property tests. Pure, no integration.
2. **Storage interface + Supabase impl** — extend `writeSeries` with `opts.metadata`, add `getLatestBar`.
3. **Indicator handle** — fast/slow paths in `_sync` and `computeAt`.
4. **Signal handle** — single-bar fast path in `_sync`.
5. **Strategy handle** — checkpoint-style `_evaluate`.
6. **Benchmarks + parity verification** — run the integration + benchmark suite; tune if any phase regresses.

## Bootstrap / deploy notes

- Existing `indicators_series` rows carry `metadata = null`. First sync after deploy takes the cold path once; from then on, the fast path every call.
- No schema migration needed. The optional partial unique index `(indicator_id) WHERE metadata IS NOT NULL` can be added later as an invariant check — not required for correctness, which is already enforced by the three-statement `writeSeries` transaction.
- The `/storage` package's Supabase provider is the only external consumer of the storage interface that needs updating; the in-memory mock used in tests gets the same two-method update.
