# StrategyHandle Design Specification

**Date:** 2026-03-31
**Status:** Approved

## Overview

StrategyHandle is the top-level composition layer of the livefolio SDK. It composes signals and allocations into a priority-ordered rule list, evaluates which allocation is active on each trading day based on a rebalancing schedule, and stores results in `strategies_series`.

## Client Factory API

Two modes via overloaded factory method:

```typescript
// Create new strategy (auto-generates nanoid link_id)
sdk.strategy(options: StrategyOptions): StrategyHandle

// Reference existing strategy by link_id
sdk.strategy(linkId: string): StrategyHandle
```

### Types

```typescript
interface StrategyRule {
  when?: SignalHandle[];  // AND-ed together; omit for fallback
  hold: AllocationHandle;
}

interface StrategyOptions {
  name: string;
  freq?: TradingFreq;     // default: 'Daily'
  offset?: number;         // default: 0
  rules: StrategyRule[];
}

interface StrategyBar {
  date: string;
  allocation: AllocationHandle;
}
```

### Usage

```typescript
const spy = sdk.ticker('SPY');
const shy = sdk.ticker('SHY');
const price = sdk.price(spy);
const sma200 = sdk.sma(spy, 200);

const bullish = sdk.gt(price, sma200, 5);

const aggressive = sdk.allocation([spy, 1.0]);
const defensive  = sdk.allocation([shy, 1.0]);

const strategy = sdk.strategy({
  name: 'Tactical SPY/SHY',
  freq: 'Monthly',
  offset: 0,
  rules: [
    { when: [bullish], hold: aggressive },
    { hold: defensive },  // fallback
  ],
});

const history = await strategy.series();
// [{ date: '2025-01-31', allocation: AllocationHandle }, ...]

const current = await strategy.value();
// AllocationHandle for latest rebalance date (carried forward)
```

## Architecture: Handle + Pure Evaluation Function

Follows the same split as SignalHandle / `evaluateSignal()`:

- **`computations/strategy.ts`** — pure `evaluateStrategy()` function and `computeRebalanceDates()` helper. No DB access, fully testable with synthetic data.
- **`handles/strategy.ts`** — StrategyHandle class owning resolve, sync, DB writes, and caching.

## StrategyHandle Class

```typescript
class StrategyHandle {
  readonly linkId: string | null;        // null when creating new (generated on resolve)
  readonly name: string | null;          // null when referencing by linkId
  readonly freq: TradingFreq;
  readonly offset: number;
  readonly rules: StrategyRule[];

  get id(): number;                      // throws if not resolved
  get link(): string;                    // throws if not resolved

  async resolve(): Promise<StrategyRow>;
  async series(range?: DateRange): Promise<StrategyBar[]>;
  async value(date?: string): Promise<AllocationHandle | null>;
}
```

Internal state:
- `_resolved: StrategyRow | null`
- `_resolving: Promise<StrategyRow> | null`
- `_cache: StrategyBar[] | null`

## Resolution Flow

### Create Mode (`sdk.strategy({ ... })`)

1. Resolve all SignalHandles and AllocationHandles in the rules (parallel where possible)
2. Generate `link_id` with `nanoid`
3. Build `definition` JSONB from resolved IDs:
   ```json
   {
     "rules": [
       { "signalIds": [5, 12], "allocationId": 3 },
       { "signalIds": [],      "allocationId": 1 }
     ]
   }
   ```
4. Insert new row into `strategies` table, return row

Each call creates a new strategy — no deduplication. The same rules and name produce separate rows with different link_ids.

### Reference Mode (`sdk.strategy('bCicNI7OI2x')`)

1. Fetch strategy row by `link_id`
2. Parse `definition` JSONB
3. Reconstruct AllocationHandle instances from allocation IDs via `AllocationHandle.fromRow()`
4. Reconstruct SignalHandle instances from signal IDs via `SignalHandle.fromRow()`
5. Populate `name`, `freq`, `offset`, and `rules` from the DB row

Requires new static factories on existing handles:
- `AllocationHandle.fromRow(supabase, row): AllocationHandle` — pre-resolved state
- `SignalHandle.fromRow(supabase, row): SignalHandle` — pre-resolved state

## Sync & Evaluation Flow

When `series()` or `value()` is called:

1. **Resolve** the strategy (if not already)
2. **Sync all signals** — call `series()` on each unique SignalHandle in the rules (triggers their full sync chain: indicators, providers, signal evaluation)
3. **Compute rebalance dates** from `trading_days` table:
   - `Daily`: every trading day
   - `Weekly/Monthly/etc.`: last trading day of each period, shifted by `offset` trading days (positive = earlier, negative = later)
4. **Freshness check** — compare latest date in `strategies_series` against latest trading day
5. **Evaluate** via pure function in `computations/strategy.ts`
6. **Upsert** results to `strategies_series` (strategy_id, trading_day_id, allocation_id)
7. **Cache** in-memory, return `StrategyBar[]`

### Dense Series

`strategies_series` stores one row per trading day, consistent with `indicators_series` and `signals_series`. On rebalance dates, the rule list is evaluated. On non-rebalance dates, the previous allocation carries forward.

## Pure Evaluation Function

```typescript
// computations/strategy.ts

function evaluateStrategy(
  signalSeries: Map<number, Map<string, boolean>>,  // signalId -> date -> value
  rules: { signalIds: number[]; allocationIndex: number }[],
  rebalanceDates: Set<string>,
  tradingDays: string[],                             // sorted, for carry-forward
): Map<string, number>                               // date -> allocationIndex
```

Logic per trading day (walked in order):
- **Rebalance date:** evaluate rules top-to-bottom. For each rule, AND all signal values. First rule where all signals are `true` (or fallback with no signals) wins. Store its allocation index.
- **Non-rebalance date:** carry forward the previous day's allocation index.

### Rebalance Date Computation

```typescript
function computeRebalanceDates(
  tradingDays: string[],
  freq: TradingFreq,
  offset: number,
): Set<string>
```

- `Daily`: all trading days (offset ignored)
- Non-daily: find last trading day of each period, shift by `offset` positions in the `tradingDays` array (positive = earlier index, negative = later index)

## Boolean Logic

- Each rule's `when` array is AND-ed together
- OR is expressed via duplicate rules pointing to the same allocation
- No NOT operator — use inverse signals (`gt` ↔ `lt`)
- AND takes precedence over OR (implicit from first-match-wins evaluation)

## Validation & Error Handling

- **Last rule must be fallback** — no `when` clause. Validated at construction time.
- **Empty rules array** — throw at construction time.
- **No match on rebalance date** — impossible if fallback rule is enforced.
- **Signal returns null for a date** — treated as `false` (condition not met).
- **Invalid link_id in reference mode** — throw on `resolve()`.
- **Trading days before first rebalance date** — no entry. Evaluation starts from the first rebalance date in the requested range.

## File Structure

### New Files
- `sdk/src/computations/strategy.ts` — `evaluateStrategy()` and `computeRebalanceDates()`
- `sdk/src/computations/strategy.test.ts` — evaluation logic tests
- `sdk/src/handles/strategy.ts` — StrategyHandle class
- `sdk/src/handles/strategy.test.ts` — handle tests

### Modified Files
- `sdk/src/client.ts` — add `strategy()` factory method (overloaded)
- `sdk/src/handles/index.ts` — export StrategyHandle
- `sdk/src/index.ts` — public API export
- `sdk/src/handles/signal.ts` — add `SignalHandle.fromRow()` static factory
- `sdk/src/handles/allocation.ts` — add `AllocationHandle.fromRow()` static factory

### New Dependency
- `nanoid` for link_id generation

## JSONB Definition Schema

```json
{
  "rules": [
    {
      "signalIds": [5, 12],
      "allocationId": 3
    },
    {
      "signalIds": [],
      "allocationId": 1
    }
  ]
}
```

Stored in `strategies.definition`. Read on reference-mode resolve to reconstruct the rule list. Written on create-mode resolve from the resolved handle IDs.
