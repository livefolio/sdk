# Allocation Handle — Lazy Holdings Container

## Overview

Add `AllocationHandle` to the SDK following the lazy handle pattern. Allocations define portfolio holdings as weighted ticker pairs. They are data containers with no time series — strategies compose them with signal conditions to produce the active allocation per trading day.

## AllocationHandle

```ts
const spy = sdk.ticker('SPY')
const gld = sdk.ticker('GLD')

const aggressive = sdk.allocation([spy, 0.75], [gld, 0.25])
const defensive = sdk.allocation([sdk.ticker('SHY'), 1.0])
```

Stores an array of `[TickerHandle, number]` pairs. Lazy — no DB call until `.resolve()`.

**Public API:**
- `resolve()` — find-or-create, returns the DB row
- `id` — getter, throws if unresolved
- `holdings` — getter, returns the `[TickerHandle, number][]` pairs for inspection

No `series()` or `value()` — allocations are data containers used by strategies.

## Resolution Logic

On `resolve()`:

1. Resolve all ticker handles in parallel to get their symbols/leverage
2. Build the `holdings` JSONB object: keys are ticker symbols (or `symbol?L=leverage` if leverage != 1), values are weights. Example: `{ "SPY": 0.75, "GLD": 0.25 }`
3. Query `SELECT * FROM allocations WHERE holdings = $jsonb` for JSONB equality match
4. If found, return the existing row
5. If not found, insert and return the new row

Uses the `_resolving` promise pattern to prevent concurrent resolution races, same as other handles.

## Client Factory

```ts
export interface LivefolioClient {
  // ...existing methods...
  allocation(...holdings: [TickerHandle, number][]): AllocationHandle;
}
```

## File Structure

```
sdk/src/
  handles/
    allocation.ts        # NEW: AllocationHandle class
    signal.ts            # unchanged
    indicator.ts         # unchanged
    ticker.ts            # unchanged
    index.ts             # MODIFY: add AllocationHandle export
  client.ts              # MODIFY: add allocation() factory
  index.ts               # MODIFY: add AllocationHandle export
```

## Design Decisions

**Data container, not a series handle:** Allocations define *what* to hold, not *when*. The time dimension comes from strategies, which pick the active allocation per trading day based on signal conditions.

**JSONB equality for deduplication:** The `allocations` table has no natural unique constraint. Rather than adding a hash column, we query by JSONB equality (`WHERE holdings = $jsonb`). This is simple and correct — the GIN index on `holdings` supports this efficiently.

**Built on TickerHandle:** Holdings reference tickers through handles, so ticker resolution is automatic. The JSONB key format uses the ticker symbol, keeping the stored data human-readable.
