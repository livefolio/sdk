# TacticalV2 — SDK Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@livefolio/sdk` (0.4.4 → 0.5.0) with lot-level portfolio bookkeeping, scheduled cash events, dividend + cash-interest hooks, a pure `tax/` module (holding-period, lot selection, aggregation, dividends, wash-sale), and two tactical-build pre-passes (drift-band tax policy + tax-loss harvesting) — implementing the SDK-only slice of [livefolio/sdk#42](https://github.com/livefolio/sdk/issues/42).

**Architecture:** `Portfolio` grows an additive long-side tax ledger — `lots` (source of truth for cost basis) and `realized` (append-only event log) — maintained *in parallel* with the existing `positions` array, which is left byte-for-byte unchanged so the v0.3↔v0.4 parity gate and `reconcile` keep working. `runBacktest` grows three per-session pre-hooks (cash events → dividends → interest accrual) before `universe/features/build`, plus a year-boundary wash-sale sweep. `fromSpec`'s `build` closure gains two pure pre-passes between rule-tree evaluation and `reconcile`. All new options are optional and default to today's behavior.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), ESM, tsup, Vitest. **No new runtime dependencies** — lot IDs use a deterministic module-scoped counter (mirroring the existing `pos_${++n}` generator), not `nanoid`.

---

## Ground-truth corrections to the upstream app-side plan

The app-side integration plan (`livefolio/app` worktree `docs/superpowers/plans/2026-05-25-tactical-v2.md`) was written without reading SDK internals and contains several **wrong assumptions**. This plan corrects them:

| App plan said | Reality (verified) | This plan does |
|---|---|---|
| `applyFills(portfolio, fills)`; fills have `f.side`/`f.asset`; `f.side === 'buy'` | `applyFills(portfolio, fills, orders)` in `src/portfolio/apply.ts`; `Fill` has `{ orderRef, t, quantity, price, fees }` — **no side, no asset**; order looked up by `fill.orderRef`, accounting driven by `order.kind` (`open`/`close`/`adjust`/`rebalance`) | Lot logic layers onto the existing `order.kind` switch; asset/direction derived from the looked-up order |
| File `portfolio/apply-fills.ts` | File is `portfolio/apply.ts` (holds both `applyFills` and `applyOrders`) | Modify `portfolio/apply.ts` |
| `positions` *becomes* a derived view | Existing `positions` switch must stay identical or the **parity gate breaks** | `positions` accounting unchanged; `lots`/`realized` added in parallel; `positionsByAsset` offered as a helper |
| `DataFeed.bars(...): Promise<Bar[]>` in `interfaces/types.ts` | `DataFeed.bars(...): AsyncIterable<Bar>` in `interfaces/**data-feed.ts**` | Add optional `kind?` param to the `AsyncIterable` signature in `data-feed.ts` |
| `BacktestExecutor({ dataFeed })` | Executor opts are `{ calendar, nextOpen, slippageBps?, perShareFee? }`; `submit(orders, t, portfolio)` receives `portfolio` (so it can read `portfolio.lots`) | Add `lotMethod?`/`taxRates?`; read lots from the `portfolio` arg |
| `BacktestSnapshot` in `strategy/types.ts` | Defined in `strategy/run-backtest.ts:87` | Add fields there |
| `runLive` returns a handle with `scheduleCashEvent()` | `runLive` returns a bare `AsyncIterable<LiveEvent>`; `LiveEvent` discriminates on **`type`** (not `kind`) | **Seed + injectable queue** (user decision): non-breaking `RunLiveOptions.cashEvents` + an optional injected `CashEventQueue` object; new `LiveEvent` variant `{ type: 'cash' }` |
| Lot IDs via `nanoid` | SDK has no `nanoid` dep; uses `pos_${++n}` counter | Deterministic `lot_${++n}` counter in `portfolio/ids.ts` |
| `computeTaxBill` defined in PR2, extended in PR4 | — | Define the **full** `TaxableIncome` (incl. dividends/interest) once in PR2; PR4 only populates it |

**Parity safety (verified):** `parity/src/parity.test.ts` compares **allocation-weight history** (`date` + `weights`), not the `fills` array or lot internals. Therefore (a) splitting sell orders into per-lot fills is parity-safe, and (b) the hard invariant is: **`applyFills` must produce identical `positions` and `cash` for the existing four order kinds.** Run `npm test parity` after every PR.

---

## Public API additions (final shapes)

All of these are re-exported from `src/index.ts`.

```ts
// portfolio/types.ts
export type IncomeKind = 'capital-gain' | 'qualified-dividend' | 'ordinary-dividend' | 'interest';

export type Lot = {
  id: string;
  asset: Asset;
  quantity: number;
  openDate: Date;
  openPrice: number;        // per-share, excludes fees
  basis: number;            // total cost for `quantity` shares (incl. fees); pro-rated on partial sale
  washSaleAdjustment?: number;
  dripParent?: string;
};

export type RealizedEvent = {
  asset: Asset;
  lotId: string;
  quantity: number;         // 0 for dividend/interest income events
  openDate: Date;
  closeDate: Date;
  proceeds: number;
  basis: number;
  termType: 'short' | 'long';
  gain: number;
  incomeKind: IncomeKind;
  washSaleDisallowed?: number;
};

export type Portfolio = {
  cash: number;
  positions: ReadonlyArray<Position>;        // UNCHANGED — authoritative for open/close/adjust/short
  lots?: ReadonlyArray<Lot>;                 // NEW — long-side tax ledger; defaults to []
  realized?: ReadonlyArray<RealizedEvent>;   // NEW — append-only income/gain log; defaults to []
  t: Date;
};

// strategy/run-backtest.ts
export type CashEvent = { t: Date; delta: number; reason?: 'deposit' | 'withdrawal' | 'interest' | 'dividend' };
export type CashYieldConfig = { kind: 'none' } | { kind: 'flat'; apy: number } | { kind: 'tbill'; spread: number; assetId?: AssetId };
export type DividendsConfig = { reinvest: boolean };
// RunBacktestOptions grows: cashEvents?, cashYield?, dividends?
// BacktestSnapshot grows: cashFlow?: number; dividendIncome?: { qualified: number; ordinary: number }; interestIncome?: number;

// strategy/run-live.ts
export class CashEventQueue { push(e: CashEvent): void; /* internal drain */ }
// RunLiveOptions grows: cashEvents?: readonly CashEvent[]; cashEventQueue?: CashEventQueue
// LiveEvent union grows: { type: 'cash'; t: Date; delta: number; reason?: CashEvent['reason'] }

// interfaces/types.ts
export type DividendEvent = {
  asset: Asset; exDate: Date; payDate: Date; amountPerShare: number;
  incomeKind: 'qualified-eligible' | 'ordinary' | 'interest';
};
// interfaces/data-feed.ts — DataFeed.bars(asset, range, freq, kind?: 'adjusted' | 'unadjusted'): AsyncIterable<Bar>
//                            DataFeed.dividends?(asset, range): Promise<DividendEvent[]>

// reference/backtest-executor.ts — BacktestExecutorOptions grows lotMethod?, taxRates?
// orders/types.ts — Fill grows lotId?: string

// tax/* and tactical/* — see per-task sections
```

---

## File structure

**Create (`src/`):**
- `portfolio/ids.ts` — `nextLotId()` deterministic counter
- `portfolio/derived.ts` — `positionsByAsset`
- `tax/index.ts` — barrel
- `tax/holding-period.ts` — `holdingPeriodDays`, `isLongTerm`, `realize`
- `tax/lot-selection.ts` — `selectFIFO`, `selectLIFO`, `selectHIFO`, `selectMinTax`, `LotSlice`, `TaxRates`
- `tax/aggregation.ts` — `bucketByTerm`, `netWithinBucket`, `crossOffset`, `aggregateByYear`, `computeTaxBill`, `TaxableIncome`
- `tax/dividends.ts` — `isQualifiedForLot`, `distributeDividend`, `reinvestDividend`
- `tax/cash-interest.ts` — `accrueCashInterest`
- `tax/wash-sale.ts` — `findWashSales`, `applyWashSaleAdjustment`, `WashSaleAdjustment`
- `tactical/drift-band.ts` — `currentWeights`, `withinDriftBand`
- `tactical/apply-tax-policy.ts` — `applyTaxPolicy`, `TaxPolicyConfig`
- `tactical/apply-tax-loss-harvest.ts` — `applyTaxLossHarvesting`, `TLHConfig`
- plus co-located `*.test.ts` for each

**Modify (`src/`):**
- `portfolio/types.ts`, `portfolio/apply.ts`, `portfolio/index.ts`
- `orders/types.ts`
- `interfaces/types.ts`, `interfaces/data-feed.ts`, `interfaces/index.ts`
- `reference/routing-data-feed.ts`, `reference/backtest-executor.ts`
- `strategy/run-backtest.ts`, `strategy/run-live.ts`, `strategy/index.ts`
- `tactical/from-spec.ts`, `tactical/index.ts`
- `index.ts`

---

## PR / phase map

| PR | Theme | Tasks | Depends on |
|---|---|---|---|
| **PR1** | Lot-shaped portfolio | T1–T4 | — |
| **PR2** | Tax module — arithmetic | T5–T8 | T1 |
| **PR3** | Cash events | T9–T11 | T1 |
| **PR4** | DataFeed contract + executor lots | T12–T15 | T1 |
| **PR5** | Dividends + cash interest | T16–T20 | T1, T4, T8, T12 |
| **PR6** | Tactical pre-passes + wash sale | T21–T25 | T1, T8, T16 |

Each PR ends green (`npm test && npm run build && npm run lint`) and parity-clean. Stop at PR boundaries for review.

---

## PR1 — Lot-shaped portfolio

### Task 1: Lot / RealizedEvent / IncomeKind types + Portfolio fields + lot-id generator

**Goal:** Land the new types and the deterministic lot-id generator. No behavior change yet.

**Files:**
- Modify: `src/portfolio/types.ts`
- Create: `src/portfolio/ids.ts`
- Modify: `src/index.ts` (re-export `Lot`, `RealizedEvent`, `IncomeKind`)
- Test: `src/portfolio/ids.test.ts`

**Acceptance Criteria:**
- [ ] `IncomeKind`, `Lot`, `RealizedEvent` exported from `src/portfolio/types.ts` with TSDoc, matching the shapes in "Public API additions".
- [ ] `Portfolio` gains `lots?: ReadonlyArray<Lot>` and `realized?: ReadonlyArray<RealizedEvent>` (optional — keeps every existing `Portfolio` literal valid).
- [ ] `nextLotId()` returns monotonically increasing `lot_1`, `lot_2`, … and is exported from `src/portfolio/ids.ts`.
- [ ] `Lot`/`RealizedEvent`/`IncomeKind` re-exported from `src/index.ts`.
- [ ] Existing suite stays green (`npm test`).

**Verify:** `cd /Users/raksi/Documents/Personal/livefolio-2/sdk/.worktrees/tactical-v2 && npm test ids && npm test portfolio`

**Steps:**

- [ ] **Step 1: Write `src/portfolio/ids.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { nextLotId } from './ids';

describe('nextLotId', () => {
  it('produces unique monotonically-increasing lot_N ids', () => {
    const a = nextLotId();
    const b = nextLotId();
    expect(a).toMatch(/^lot_\d+$/);
    expect(b).toMatch(/^lot_\d+$/);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run → fails** (`Cannot find module './ids'`).

  Run: `npm test ids`

- [ ] **Step 3: Create `src/portfolio/ids.ts`** (mirrors the existing `newPositionId` pattern in `apply.ts`)

```ts
/**
 * Deterministic, process-monotonic id generator for {@link Lot} records.
 *
 * Mirrors the `pos_${n}` scheme used for positions. Lot ids are opaque — do
 * not parse them. Determinism keeps backtests reproducible run-to-run within a
 * process; tests MUST assert lot *structure*, never exact ids.
 */
let _lotCounter = 0;
export function nextLotId(): string {
  return `lot_${++_lotCounter}`;
}
```

- [ ] **Step 4: Edit `src/portfolio/types.ts`** — add the three new types above `Portfolio`, and add the two optional fields to `Portfolio`. Use this exact text (insert after the `Position` type, before the `Portfolio` doc comment):

```ts
/**
 * Tax classification of a {@link RealizedEvent}. Drives which rate bucket the
 * income falls into during {@link aggregateByYear} / {@link computeTaxBill}.
 */
export type IncomeKind = 'capital-gain' | 'qualified-dividend' | 'ordinary-dividend' | 'interest';

/**
 * A single tax lot — one acquisition of `quantity` shares of `asset` at a
 * point in time. The cost-basis source of truth for long holdings. Partial
 * sales reduce `quantity` and pro-rate `basis`.
 */
export type Lot = {
  /** Opaque id assigned by {@link nextLotId} on creation. */
  id: string;
  asset: Asset;
  /** Shares remaining in this lot after any partial sales. */
  quantity: number;
  /** Date the lot was opened (a DRIP lot's clock starts at its pay date). */
  openDate: Date;
  /** Per-share open price, excluding fees. */
  openPrice: number;
  /** Total cost basis for `quantity` shares incl. entry fees; pro-rated on partial sale and bumped by wash-sale §1091. */
  basis: number;
  /** Running total of disallowed wash-sale losses absorbed into `basis`. */
  washSaleAdjustment?: number;
  /** Set when this lot was created via dividend reinvestment; references the lot whose dividend funded it. */
  dripParent?: string;
};

/**
 * An append-only record of realized taxable activity: a capital gain/loss from
 * closing (part of) a lot, or dividend/interest income. `quantity` is `0` for
 * income events (dividends, interest), which carry `basis: 0` and `gain = proceeds`.
 */
export type RealizedEvent = {
  asset: Asset;
  /** The lot this event closed against. For income events, a reference token (e.g. the paying lot, or `'cash'` for interest). */
  lotId: string;
  quantity: number;
  openDate: Date;
  closeDate: Date;
  proceeds: number;
  basis: number;
  termType: 'short' | 'long';
  gain: number;
  incomeKind: IncomeKind;
  /** When `> 0`, this much of a (negative) capital gain was disallowed by the wash-sale rule and rolled into a replacement lot's basis. */
  washSaleDisallowed?: number;
};
```

Then add to the `Portfolio` type (after the `positions` field):

```ts
  /**
   * Long-side tax ledger — the cost-basis source of truth for lot accounting.
   * Maintained in parallel with `positions` by {@link applyFills}; defaults to
   * `[]` when absent. Short positions and `adjust` orders do not participate.
   */
  lots?: ReadonlyArray<Lot>;
  /**
   * Append-only log of realized capital gains and dividend/interest income
   * accumulated during a run. Defaults to `[]` when absent.
   */
  realized?: ReadonlyArray<RealizedEvent>;
```

(`Asset` is already imported at the top of `types.ts`.)

- [ ] **Step 5: Run → passes.** `npm test ids`

- [ ] **Step 6: Re-export from `src/index.ts`** — extend the Portfolio type export block (around line 133):

```ts
export type { Position, Portfolio, PositionId, Lot, RealizedEvent, IncomeKind } from './portfolio';
```

  And ensure `src/portfolio/index.ts` re-exports them from `./types`.

- [ ] **Step 7: Full suite + commit**

```bash
npm test && npm run build
git add src/portfolio/types.ts src/portfolio/ids.ts src/portfolio/ids.test.ts src/portfolio/index.ts src/index.ts
git commit -m "feat(sdk): Lot/RealizedEvent/IncomeKind types + Portfolio.lots/realized + nextLotId"
```

---

### Task 2: `positionsByAsset` derived view

**Goal:** A pure helper that aggregates `portfolio.lots` into a per-asset `Position[]` (the lot-aggregated view consumers can opt into).

**Files:**
- Create: `src/portfolio/derived.ts`
- Test: `src/portfolio/derived.test.ts`
- Modify: `src/portfolio/index.ts`, `src/index.ts` (export `positionsByAsset`)

**Acceptance Criteria:**
- [ ] `positionsByAsset(portfolio)` returns one `Position` per distinct `asset.id` present in `portfolio.lots ?? []`, summing `quantity` and `basis`.
- [ ] `entry` uses the earliest lot's `{ date: openDate, price: openPrice }`.
- [ ] `side` is always `'long'` (lots model long holdings).
- [ ] Empty/absent `lots` → `[]`.
- [ ] Exported from `src/index.ts`.

**Verify:** `npm test derived`

**Steps:**

- [ ] **Step 1: Write `src/portfolio/derived.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { positionsByAsset } from './derived';
import type { Portfolio } from './types';

const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };

describe('positionsByAsset', () => {
  it('aggregates multiple lots of the same asset', () => {
    const p: Portfolio = {
      cash: 0, positions: [], realized: [], t: new Date('2024-06-01'),
      lots: [
        { id: 'l1', asset, quantity: 10, basis: 1000, openDate: new Date('2024-01-01'), openPrice: 100 },
        { id: 'l2', asset, quantity: 5, basis: 600, openDate: new Date('2024-06-01'), openPrice: 120 },
      ],
    };
    const pos = positionsByAsset(p);
    expect(pos).toHaveLength(1);
    expect(pos[0]!.quantity).toBe(15);
    expect(pos[0]!.basis).toBe(1600);
    expect(pos[0]!.side).toBe('long');
    expect(pos[0]!.entry.date).toEqual(new Date('2024-01-01')); // earliest
  });

  it('returns [] when lots are absent', () => {
    expect(positionsByAsset({ cash: 100, positions: [], t: new Date() })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fails.** `npm test derived`

- [ ] **Step 3: Create `src/portfolio/derived.ts`**

```ts
import type { Lot, Portfolio, Position } from './types';

/**
 * Aggregates a portfolio's tax {@link Lot}s into a per-asset {@link Position}
 * view (`side: 'long'`). The lot-level analogue of `portfolio.positions`,
 * offered for consumers that want a single position per asset derived from the
 * cost-basis ledger. `reconcile` continues to read `portfolio.positions`.
 *
 * @param portfolio - Source portfolio; reads `portfolio.lots` (treated as `[]` when absent).
 * @returns One {@link Position} per distinct asset id, summing quantity and basis,
 *   with `entry` taken from the earliest lot. Empty when there are no lots.
 */
export function positionsByAsset(portfolio: Portfolio): Position[] {
  const byId = new Map<string, { asset: Lot['asset']; quantity: number; basis: number; openDate: Date; openPrice: number }>();
  for (const lot of portfolio.lots ?? []) {
    const cur = byId.get(lot.asset.id);
    if (cur) {
      cur.quantity += lot.quantity;
      cur.basis += lot.basis;
      if (lot.openDate < cur.openDate) {
        cur.openDate = lot.openDate;
        cur.openPrice = lot.openPrice;
      }
    } else {
      byId.set(lot.asset.id, {
        asset: lot.asset,
        quantity: lot.quantity,
        basis: lot.basis,
        openDate: lot.openDate,
        openPrice: lot.openPrice,
      });
    }
  }
  let i = 0;
  return Array.from(byId.values()).map((agg) => ({
    id: `pos_lot_${agg.asset.id}_${i++}`,
    asset: agg.asset,
    side: 'long' as const,
    quantity: agg.quantity,
    entry: { date: agg.openDate, price: agg.openPrice },
    basis: agg.basis,
  }));
}
```

- [ ] **Step 4: Run → passes.** `npm test derived`

- [ ] **Step 5: Export** from `src/portfolio/index.ts` (`export { positionsByAsset } from './derived';`) and `src/index.ts` (add `positionsByAsset` to the `export { applyFills, applyOrders } from './portfolio';` line).

- [ ] **Step 6: Commit**

```bash
npm test && git add src/portfolio/derived.ts src/portfolio/derived.test.ts src/portfolio/index.ts src/index.ts
git commit -m "feat(sdk): positionsByAsset derived view over portfolio.lots"
```

---

### Task 3: `Fill.lotId` field

**Goal:** Add the optional `lotId` discriminator to `Fill` so the executor can target a specific lot on a sell. Pure type change.

**Files:**
- Modify: `src/orders/types.ts`
- Test: `src/orders/types.test.ts` (create if absent; otherwise add a type-only case)

**Acceptance Criteria:**
- [ ] `Fill` gains `lotId?: string` with TSDoc.
- [ ] A `Fill` literal without `lotId` still type-checks (non-breaking).

**Verify:** `npm test orders && npm run build`

**Steps:**

- [ ] **Step 1: Add the field** to `Fill` in `src/orders/types.ts` (after `fees`):

```ts
  /**
   * Optional id of the specific {@link Lot} this fill draws from on a sell.
   * Set by {@link BacktestExecutor} when a `lotMethod` is configured so
   * {@link applyFills} consumes the chosen lot rather than defaulting to FIFO.
   * Absent on buys and on default-FIFO sells.
   */
  lotId?: string;
```

- [ ] **Step 2: Type-only test** in `src/orders/types.test.ts`:

```ts
import { describe, it, expectTypeOf } from 'vitest';
import type { Fill } from './types';

describe('Fill.lotId', () => {
  it('is optional', () => {
    const a: Fill = { orderRef: 'o1', t: new Date(), quantity: 1, price: 10, fees: 0 };
    const b: Fill = { orderRef: 'o1', t: new Date(), quantity: 1, price: 10, fees: 0, lotId: 'lot_1' };
    expectTypeOf(a).toMatchTypeOf<Fill>();
    expectTypeOf(b).toMatchTypeOf<Fill>();
  });
});
```

- [ ] **Step 3: Verify + commit**

```bash
npm test orders && npm run build
git add src/orders/types.ts src/orders/types.test.ts
git commit -m "feat(sdk): add optional Fill.lotId for per-lot sell targeting"
```

---

### Task 4: `applyFills` maintains lots + realized (default FIFO), positions unchanged

**Goal:** Make `applyFills` additionally maintain `lots` and `realized` for long-side share flow, while leaving the existing `positions`/`cash` accounting **byte-for-byte identical** (parity-critical). Buys create lots; sells consume lots (by `fill.lotId` if present, else FIFO) and emit `RealizedEvent`s.

**Files:**
- Modify: `src/portfolio/apply.ts`
- Modify: `src/portfolio/apply.test.ts`

**Acceptance Criteria:**
- [ ] Existing `positions` and `cash` outputs are unchanged for all four order kinds (verified by the pre-existing tests still passing untouched in their assertions, plus `npm test parity`).
- [ ] Lot side-effects (in addition to existing logic):
  - `open` (long) and `rebalance` with `delta > 0` → append a `Lot` `{ id: nextLotId(), asset, quantity: fill.quantity, openDate: fill.t, openPrice: fill.price, basis: fill.quantity*fill.price + fill.fees }`.
  - `rebalance` with `delta < 0` and `close` of a long position → consume lots for that asset (by `fill.lotId` if set, else FIFO oldest-first), pro-rate basis, append one `RealizedEvent` per consumed slice with `termType` via the 365-day rule, `incomeKind: 'capital-gain'`, `gain = proceeds - basis`. Proceeds per slice = `take * fill.price` minus a pro-rata share of `fill.fees`.
  - `open` short, `close` of a short, and `adjust` → **do not** touch lots/realized (documented limitation; not exercised by the tactical path).
- [ ] Selling more long shares than the lot ledger holds for that asset throws `RangeError` naming the asset and shortfall.
- [ ] `lots` with `quantity <= 0` are pruned after each fill.
- [ ] Output `portfolio.lots`/`realized` are always present (arrays) on the returned snapshot.

**Verify:** `npm test apply && npm test parity`

**Steps:**

- [ ] **Step 1: Add helper + thread lot state.** At the top of `src/portfolio/apply.ts` add imports and a consumption helper:

```ts
import { nextLotId } from './ids';
import type { Lot, RealizedEvent } from './types';

const MS_PER_DAY = 86_400_000;
const isLong = (openDate: Date, closeDate: Date): boolean =>
  (closeDate.getTime() - openDate.getTime()) / MS_PER_DAY > 365;

/**
 * Consume `qty` long shares of `assetId` from `lots`, oldest-first unless
 * `preferLotId` selects a specific lot first. Mutates the passed `lots` array
 * (caller owns a fresh copy) and pushes one RealizedEvent per slice to `realized`.
 */
function consumeLots(
  lots: Lot[],
  realized: RealizedEvent[],
  assetId: string,
  qty: number,
  price: number,
  fees: number,
  closeDate: Date,
  preferLotId?: string,
): void {
  const order = lots
    .map((l, i) => ({ l, i }))
    .filter((x) => x.l.asset.id === assetId && x.l.quantity > 0)
    .sort((a, b) => {
      if (preferLotId) {
        if (a.l.id === preferLotId) return -1;
        if (b.l.id === preferLotId) return 1;
      }
      return a.l.openDate.getTime() - b.l.openDate.getTime();
    });
  const held = order.reduce((s, x) => s + x.l.quantity, 0);
  if (held < qty) {
    throw new RangeError(`applyFills: cannot sell ${qty} of ${assetId} — lot ledger holds ${held}`);
  }
  let need = qty;
  const totalQty = qty;
  for (const { l } of order) {
    if (need <= 0) break;
    const take = Math.min(l.quantity, need);
    const basisPerShare = l.basis / l.quantity;
    const consumedBasis = basisPerShare * take;
    const proceeds = take * price - (take / totalQty) * fees;
    realized.push({
      asset: l.asset,
      lotId: l.id,
      quantity: take,
      openDate: l.openDate,
      closeDate,
      proceeds,
      basis: consumedBasis,
      termType: isLong(l.openDate, closeDate) ? 'long' : 'short',
      gain: proceeds - consumedBasis,
      incomeKind: 'capital-gain',
    });
    l.quantity -= take;
    l.basis -= consumedBasis;
    need -= take;
  }
}
```

- [ ] **Step 2: Thread `lots`/`realized` through `applyFills`.** Initialize alongside the existing `positions`/`cash`/`t`:

```ts
  let positions: Position[] = [...portfolio.positions];
  let cash = portfolio.cash;
  let t = portfolio.t;
  const lots: Lot[] = (portfolio.lots ?? []).map((l) => ({ ...l }));   // deep-ish copy (mutated in place)
  const realized: RealizedEvent[] = [...(portfolio.realized ?? [])];
```

  **Do not change any existing `positions`/`cash` mutation.** Add lot side-effects inside the existing `switch (order.kind)` cases:

  - In `case 'open':` after the existing position push, if `order.side === 'long'`:
    ```ts
    if (order.side === 'long') {
      lots.push({ id: nextLotId(), asset: order.asset, quantity: fill.quantity, openDate: fill.t, openPrice: fill.price, basis: fill.quantity * fill.price + fill.fees });
    }
    ```
  - In `case 'close':` after the existing logic, if the closed position was long:
    ```ts
    if (pos.side === 'long') {
      consumeLots(lots, realized, pos.asset.id, fill.quantity, fill.price, fill.fees, fill.t, fill.lotId);
    }
    ```
    (Capture `pos` before the `positions` array is filtered.)
  - In `case 'rebalance':` — for `delta > 0` (after existing buy logic): `lots.push({ id: nextLotId(), asset: order.asset, quantity: fill.quantity, openDate: fill.t, openPrice: fill.price, basis: fill.quantity * fill.price + fill.fees });`
    For the reduce branch (`else if (idx >= 0)`, after existing logic): `consumeLots(lots, realized, order.asset.id, fill.quantity, fill.price, fill.fees, fill.t, fill.lotId);`
  - `case 'adjust':` — no lot change (documented).

- [ ] **Step 3: Prune + return.** At the end of the fill loop add `for (let i = lots.length - 1; i >= 0; i--) if (lots[i]!.quantity <= 1e-9) lots.splice(i, 1);` and change the return to:

```ts
  return { cash, positions, lots, realized, t };
```

  Update the TSDoc on `applyFills` to mention the parallel lot ledger.

- [ ] **Step 4: Extend `src/portfolio/apply.test.ts`** — keep all existing assertions intact; add lot cases:

```ts
import { positionsByAsset } from './derived';
// ... within describe('applyFills', ...)

it('a rebalance buy creates a lot', () => {
  const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
  const p0 = { cash: 10_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
  const order = { id: 'o1', kind: 'rebalance' as const, asset, delta: 100 };
  const fill = { orderRef: 'o1', t: new Date('2024-01-02'), quantity: 100, price: 10, fees: 0 };
  const next = applyFills(p0, [fill], [order]);
  expect(next.lots).toHaveLength(1);
  expect(next.lots![0]!.quantity).toBe(100);
  expect(next.lots![0]!.basis).toBe(1000);
});

it('FIFO sell emits one realized event and reduces the oldest lot', () => {
  const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
  let p = { cash: 10_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
  p = applyFills(p, [{ orderRef: 'b', t: new Date('2024-01-02'), quantity: 100, price: 10, fees: 0 }], [{ id: 'b', kind: 'rebalance', asset, delta: 100 }]);
  p = applyFills(p, [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 75, price: 30, fees: 0 }], [{ id: 's', kind: 'rebalance', asset, delta: -75 }]);
  expect(p.realized).toHaveLength(1);
  expect(p.realized![0]!.gain).toBeCloseTo(75 * 30 - 75 * 10); // 1500
  expect(p.realized![0]!.termType).toBe('short');
  expect(p.lots![0]!.quantity).toBe(25);
});

it('a sell spanning two lots emits two realized events', () => {
  const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
  let p = { cash: 100_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
  p = applyFills(p, [{ orderRef: 'b1', t: new Date('2024-01-02'), quantity: 100, price: 10, fees: 0 }], [{ id: 'b1', kind: 'rebalance', asset, delta: 100 }]);
  p = applyFills(p, [{ orderRef: 'b2', t: new Date('2024-02-02'), quantity: 50, price: 20, fees: 0 }], [{ id: 'b2', kind: 'rebalance', asset, delta: 50 }]);
  p = applyFills(p, [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 120, price: 30, fees: 0 }], [{ id: 's', kind: 'rebalance', asset, delta: -120 }]);
  expect(p.realized).toHaveLength(2);
  expect(p.realized![0]!.quantity).toBe(100);
  expect(p.realized![1]!.quantity).toBe(20);
});

it('overselling the lot ledger throws RangeError', () => {
  const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
  let p = { cash: 10_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
  p = applyFills(p, [{ orderRef: 'b', t: new Date('2024-01-02'), quantity: 10, price: 10, fees: 0 }], [{ id: 'b', kind: 'rebalance', asset, delta: 10 }]);
  expect(() => applyFills(p, [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 50, price: 30, fees: 0 }], [{ id: 's', kind: 'rebalance', asset, delta: -50 }])).toThrow(/cannot sell/);
});

it('honors fill.lotId over FIFO when present', () => {
  const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
  let p = { cash: 100_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
  p = applyFills(p, [{ orderRef: 'b1', t: new Date('2024-01-02'), quantity: 10, price: 10, fees: 0 }], [{ id: 'b1', kind: 'rebalance', asset, delta: 10 }]);
  p = applyFills(p, [{ orderRef: 'b2', t: new Date('2024-02-02'), quantity: 10, price: 20, fees: 0 }], [{ id: 'b2', kind: 'rebalance', asset, delta: 10 }]);
  const newerLotId = p.lots![1]!.id;
  p = applyFills(p, [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 5, price: 30, fees: 0, lotId: newerLotId }], [{ id: 's', kind: 'rebalance', asset, delta: -5 }]);
  // newer lot (basis 20/sh) was consumed first
  expect(p.realized![0]!.basis).toBeCloseTo(5 * 20);
});
```

- [ ] **Step 5: Run → passes; parity green.**

```bash
npm test apply && npm test parity
```

- [ ] **Step 6: Commit**

```bash
git add src/portfolio/apply.ts src/portfolio/apply.test.ts
git commit -m "feat(sdk): applyFills maintains lots + realized ledger (positions unchanged)"
```

> **PR1 done:** `npm test && npm run build && npm run lint`. Review checkpoint.

---

## PR2 — Tax module (pure arithmetic)

### Task 5: `tax/holding-period.ts`

**Goal:** Pure holding-period arithmetic and partial-sale realization.

**Files:**
- Create: `src/tax/holding-period.ts`, `src/tax/holding-period.test.ts`, `src/tax/index.ts`

**Acceptance Criteria:**
- [ ] `holdingPeriodDays(lot, asOf)` = `(asOf - openDate) / 86_400_000` (float).
- [ ] `isLongTerm(days)` = `days > 365` (strict; 365 → short, 366 → long).
- [ ] `realize(lot, qty, salePrice, asOf)` → `{ event, remainingLot }`; pro-rates basis; `incomeKind: 'capital-gain'`; `remainingLot` is `null` when `qty === lot.quantity`.
- [ ] Throws `RangeError` if `qty <= 0` or `qty > lot.quantity`.

**Verify:** `npm test holding-period`

**Steps:**

- [ ] **Step 1: Test `src/tax/holding-period.test.ts`** — use the cases from issue Task 18 (365 short / 366 long; partial pro-rate; full sale → null remainder; oversell throws).

```ts
import { describe, it, expect } from 'vitest';
import { holdingPeriodDays, isLongTerm, realize } from './holding-period';
import type { Lot } from '../portfolio/types';

const lot: Lot = { id: 'L1', asset: { kind: 'equity', id: 'SPY', symbol: 'SPY' }, quantity: 100, openDate: new Date('2024-01-15'), openPrice: 400, basis: 40_000 };

describe('holding-period', () => {
  it('365 days is short-term, 366 is long-term', () => {
    expect(isLongTerm(365)).toBe(false);
    expect(isLongTerm(366)).toBe(true);
  });
  it('realize partial sale pro-rates basis', () => {
    const r = realize(lot, 25, 500, new Date('2024-06-15'));
    expect(r.event.basis).toBeCloseTo(10_000);
    expect(r.event.proceeds).toBe(12_500);
    expect(r.event.gain).toBeCloseTo(2_500);
    expect(r.event.termType).toBe('short');
    expect(r.remainingLot!.quantity).toBe(75);
    expect(r.remainingLot!.basis).toBeCloseTo(30_000);
  });
  it('realize full sale yields no remainder, long-term past 1y', () => {
    const r = realize(lot, 100, 500, new Date('2025-06-15'));
    expect(r.remainingLot).toBeNull();
    expect(r.event.termType).toBe('long');
  });
  it('realize throws on oversell or non-positive qty', () => {
    expect(() => realize(lot, 101, 500, new Date('2024-06-15'))).toThrow(/cannot sell|exceeds/);
    expect(() => realize(lot, 0, 500, new Date('2024-06-15'))).toThrow(/positive/);
  });
});
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement `src/tax/holding-period.ts`** (the issue's Task-18 code is correct here):

```ts
import type { Lot, RealizedEvent } from '../portfolio/types';

const MS_PER_DAY = 86_400_000;

/** Float days between a lot's open date and `asOf`. Callers may floor. */
export function holdingPeriodDays(lot: Lot, asOf: Date): number {
  return (asOf.getTime() - lot.openDate.getTime()) / MS_PER_DAY;
}

/** IRS rule: a holding period of strictly more than 365 days is long-term. */
export function isLongTerm(days: number): boolean {
  return days > 365;
}

export type RealizeResult = { event: RealizedEvent; remainingLot: Lot | null };

/** Realize `qty` shares of `lot` at `salePrice` as of `asOf`. Pro-rates basis. */
export function realize(lot: Lot, qty: number, salePrice: number, asOf: Date): RealizeResult {
  if (qty <= 0) throw new RangeError(`realize: qty must be positive, got ${qty}`);
  if (qty > lot.quantity) throw new RangeError(`realize: lot ${lot.id} has ${lot.quantity}, cannot sell ${qty}`);
  const basisPerShare = lot.basis / lot.quantity;
  const basis = basisPerShare * qty;
  const proceeds = qty * salePrice;
  const event: RealizedEvent = {
    asset: lot.asset, lotId: lot.id, quantity: qty,
    openDate: lot.openDate, closeDate: asOf, proceeds, basis,
    termType: isLongTerm(holdingPeriodDays(lot, asOf)) ? 'long' : 'short',
    gain: proceeds - basis, incomeKind: 'capital-gain',
  };
  const remainingLot: Lot | null = qty === lot.quantity ? null : { ...lot, quantity: lot.quantity - qty, basis: lot.basis - basis };
  return { event, remainingLot };
}
```

- [ ] **Step 4: Create barrel `src/tax/index.ts`** with `export * from './holding-period';`

- [ ] **Step 5: Run → passes; commit.**

```bash
npm test holding-period
git add src/tax/holding-period.ts src/tax/holding-period.test.ts src/tax/index.ts
git commit -m "feat(sdk/tax): holding-period + realize utilities"
```

---

### Task 6: `tax/lot-selection.ts` (FIFO/LIFO/HIFO/min-tax)

**Goal:** Pure lot selectors producing `LotSlice[]` summing to the requested quantity.

**Files:**
- Create: `src/tax/lot-selection.ts`, `src/tax/lot-selection.test.ts`
- Modify: `src/tax/index.ts`

**Acceptance Criteria:**
- [ ] `LotSlice = { lotId: string; quantity: number }`; `TaxRates = { shortTerm: number; longTerm: number }`.
- [ ] `selectFIFO` (openDate asc), `selectLIFO` (openDate desc), `selectHIFO` (basis-per-share desc).
- [ ] `selectMinTax(lots, qty, { price, asOf, rates })` ranks lots by a 4-tier comparator: (1) long-term losses (most negative gain/share first), (2) short-term losses, (3) long-term gains (smallest gain/share first), (4) short-term gains.
- [ ] All skip `quantity <= 0` lots and throw `RangeError` when the total held `< qty`.

**Verify:** `npm test lot-selection`

**Steps:**

- [ ] **Step 1: Tests** covering FIFO/LIFO/HIFO id-order on a 3-lot fixture, min-tax putting a large LT loss first, and the insufficient-quantity throw. (Write explicit fixtures asserting the returned `lotId` order.)

- [ ] **Step 2: Implement `src/tax/lot-selection.ts`**

```ts
import type { Lot } from '../portfolio/types';
import { holdingPeriodDays, isLongTerm } from './holding-period';

export type LotSlice = { lotId: string; quantity: number };
export type TaxRates = { shortTerm: number; longTerm: number };

function take(sorted: readonly Lot[], qty: number): LotSlice[] {
  let need = qty;
  const out: LotSlice[] = [];
  for (const lot of sorted) {
    if (lot.quantity <= 0) continue;
    if (need <= 0) break;
    const q = Math.min(lot.quantity, need);
    out.push({ lotId: lot.id, quantity: q });
    need -= q;
  }
  if (need > 1e-9) {
    const held = sorted.reduce((s, l) => s + Math.max(0, l.quantity), 0);
    throw new RangeError(`lot-selection: need ${qty} but only ${held} held`);
  }
  return out;
}

export function selectFIFO(lots: readonly Lot[], qty: number): LotSlice[] {
  return take([...lots].sort((a, b) => a.openDate.getTime() - b.openDate.getTime()), qty);
}
export function selectLIFO(lots: readonly Lot[], qty: number): LotSlice[] {
  return take([...lots].sort((a, b) => b.openDate.getTime() - a.openDate.getTime()), qty);
}
export function selectHIFO(lots: readonly Lot[], qty: number): LotSlice[] {
  return take([...lots].sort((a, b) => b.basis / b.quantity - a.basis / a.quantity), qty);
}

/**
 * Rank lots to minimize realized tax for selling `qty` at `ctx.price`:
 * LT losses → ST losses → LT gains (smallest) → ST gains (smallest).
 */
export function selectMinTax(
  lots: readonly Lot[],
  qty: number,
  ctx: { price: number; asOf: Date; rates: TaxRates },
): LotSlice[] {
  const tier = (l: Lot): number => {
    const gainPerShare = ctx.price - l.basis / l.quantity;
    const lt = isLongTerm(holdingPeriodDays(l, ctx.asOf));
    if (gainPerShare < 0) return lt ? 0 : 1;       // losses first (LT before ST)
    return lt ? 2 : 3;                              // then gains (LT before ST)
  };
  const sorted = [...lots].filter((l) => l.quantity > 0).sort((a, b) => {
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    // within a tier, smaller gain-per-share first (bigger loss / smaller gain)
    return (ctx.price - a.basis / a.quantity) - (ctx.price - b.basis / b.quantity);
  });
  return take(sorted, qty);
}
```

- [ ] **Step 3: Re-export** from `tax/index.ts` (`export * from './lot-selection';`).

- [ ] **Step 4: Run → passes; commit.**

```bash
npm test lot-selection
git add src/tax/lot-selection.ts src/tax/lot-selection.test.ts src/tax/index.ts
git commit -m "feat(sdk/tax): FIFO/LIFO/HIFO/min-tax lot selectors"
```

---

### Task 7: `tax/aggregation.ts` — bucketing, offsets, tax bill (full income shape)

**Goal:** Year-level aggregation with the **complete** `TaxableIncome` shape (capital gains + dividends + interest) defined once, so PR5 only populates it.

**Files:**
- Create: `src/tax/aggregation.ts`, `src/tax/aggregation.test.ts`
- Modify: `src/tax/index.ts`

**Acceptance Criteria:**
- [ ] `TaxableIncome = { shortTermGains; shortTermLosses; longTermGains; longTermLosses; qualifiedDividends; ordinaryDividends; interestIncome }` (all numbers; losses stored as positive magnitudes).
- [ ] `bucketByTerm(events)` → `{ short: RealizedEvent[]; long: RealizedEvent[] }` for `incomeKind === 'capital-gain'` only.
- [ ] `netWithinBucket(events)` → `{ gains; losses; net }` (losses positive).
- [ ] `crossOffset(netShort, netLong)` → `{ taxableShort; taxableLong; ordinaryOffset; carryForward }`: opposite signs cancel smaller-into-larger keeping residual in the larger's term; both-negative routes up to `ORDINARY_OFFSET_CAP = 3000` to `ordinaryOffset`, remainder to `carryForward`.
- [ ] `aggregateByYear(events)` → `Map<number, TaxableIncome>` keyed by `closeDate.getUTCFullYear()`, summing per income kind (capital gains bucketed by term; `qualified-dividend`/`ordinary-dividend`/`interest` into their fields).
- [ ] `computeTaxBill(income, rates)` → `{ total; breakdown: { ordinaryPortion; ltPortion; carryForward } }` where `ordinaryPortion = (taxableShort + ordinaryDividends + interestIncome) * shortTerm`, `ltPortion = (taxableLong + qualifiedDividends) * longTerm`. **Capital losses do NOT offset qualified dividends.**

**Verify:** `npm test aggregation`

**Steps:**

- [ ] **Step 1: Tests** — pure-gain both buckets; ST-loss vs LT-gain; LT-loss vs ST-gain; both-negative ($3k→ordinary, rest carryForward); and the critical case `{ longTermLosses: 10000, qualifiedDividends: 5000 }` → `ltPortion` taxes the full $5000 (losses don't offset it), `carryForward` reflects the unused loss.

- [ ] **Step 2: Implement `src/tax/aggregation.ts`**

```ts
import type { RealizedEvent } from '../portfolio/types';
import type { TaxRates } from './lot-selection';

export const ORDINARY_OFFSET_CAP = 3000;

export type TaxableIncome = {
  shortTermGains: number;
  shortTermLosses: number;   // positive magnitude
  longTermGains: number;
  longTermLosses: number;    // positive magnitude
  qualifiedDividends: number;
  ordinaryDividends: number;
  interestIncome: number;
};

export function bucketByTerm(events: readonly RealizedEvent[]): { short: RealizedEvent[]; long: RealizedEvent[] } {
  const short: RealizedEvent[] = [], long: RealizedEvent[] = [];
  for (const e of events) {
    if (e.incomeKind !== 'capital-gain') continue;
    (e.termType === 'long' ? long : short).push(e);
  }
  return { short, long };
}

export function netWithinBucket(events: readonly RealizedEvent[]): { gains: number; losses: number; net: number } {
  let gains = 0, losses = 0;
  for (const e of events) {
    if (e.gain >= 0) gains += e.gain;
    else losses += -e.gain;
  }
  return { gains, losses, net: gains - losses };
}

export function crossOffset(
  netShort: number,
  netLong: number,
): { taxableShort: number; taxableLong: number; ordinaryOffset: number; carryForward: number } {
  if (netShort >= 0 && netLong >= 0) return { taxableShort: netShort, taxableLong: netLong, ordinaryOffset: 0, carryForward: 0 };
  if (netShort < 0 && netLong < 0) {
    const totalLoss = -(netShort + netLong);
    const ordinaryOffset = Math.min(ORDINARY_OFFSET_CAP, totalLoss);
    return { taxableShort: 0, taxableLong: 0, ordinaryOffset, carryForward: totalLoss - ordinaryOffset };
  }
  // opposite signs → cancel
  const combined = netShort + netLong;
  if (combined >= 0) {
    // the negative bucket fully absorbed; residual stays in the positive bucket's term
    const taxableShort = netShort > 0 ? combined : 0;
    const taxableLong = netLong > 0 ? combined : 0;
    return { taxableShort: Math.max(0, taxableShort), taxableLong: Math.max(0, taxableLong), ordinaryOffset: 0, carryForward: 0 };
  }
  // net loss after cross-offset → up to cap to ordinary
  const loss = -combined;
  const ordinaryOffset = Math.min(ORDINARY_OFFSET_CAP, loss);
  return { taxableShort: 0, taxableLong: 0, ordinaryOffset, carryForward: loss - ordinaryOffset };
}

export function aggregateByYear(events: readonly RealizedEvent[]): Map<number, TaxableIncome> {
  const out = new Map<number, TaxableIncome>();
  const blank = (): TaxableIncome => ({ shortTermGains: 0, shortTermLosses: 0, longTermGains: 0, longTermLosses: 0, qualifiedDividends: 0, ordinaryDividends: 0, interestIncome: 0 });
  for (const e of events) {
    const y = e.closeDate.getUTCFullYear();
    const acc = out.get(y) ?? blank();
    switch (e.incomeKind) {
      case 'capital-gain':
        if (e.termType === 'long') { if (e.gain >= 0) acc.longTermGains += e.gain; else acc.longTermLosses += -e.gain; }
        else { if (e.gain >= 0) acc.shortTermGains += e.gain; else acc.shortTermLosses += -e.gain; }
        break;
      case 'qualified-dividend': acc.qualifiedDividends += e.proceeds; break;
      case 'ordinary-dividend': acc.ordinaryDividends += e.proceeds; break;
      case 'interest': acc.interestIncome += e.proceeds; break;
    }
    out.set(y, acc);
  }
  return out;
}

export function computeTaxBill(
  income: TaxableIncome,
  rates: TaxRates,
): { total: number; breakdown: { ordinaryPortion: number; ltPortion: number; carryForward: number } } {
  const netShort = income.shortTermGains - income.shortTermLosses;
  const netLong = income.longTermGains - income.longTermLosses;
  const off = crossOffset(netShort, netLong);
  // Qualified dividends pool with LT gains; capital losses never offset them.
  const ordinaryPortion = (off.taxableShort + income.ordinaryDividends + income.interestIncome) * rates.shortTerm;
  const ltPortion = (off.taxableLong + income.qualifiedDividends) * rates.longTerm;
  return { total: ordinaryPortion + ltPortion, breakdown: { ordinaryPortion, ltPortion, carryForward: off.carryForward } };
}
```

- [ ] **Step 3: Re-export + run + commit.**

```bash
npm test aggregation
git add src/tax/aggregation.ts src/tax/aggregation.test.ts src/tax/index.ts
git commit -m "feat(sdk/tax): aggregation (bucket/offset/aggregateByYear/computeTaxBill)"
```

---

### Task 8: Re-export `tax/` arithmetic from the package root

**Goal:** Surface PR2's pure utilities on `@livefolio/sdk` with TSDoc and a `tax` namespace alias (matching the `tactical`/`features` pattern).

**Files:**
- Modify: `src/index.ts`

**Acceptance Criteria:**
- [ ] `holdingPeriodDays`, `isLongTerm`, `realize`, `selectFIFO`, `selectLIFO`, `selectHIFO`, `selectMinTax`, `bucketByTerm`, `netWithinBucket`, `crossOffset`, `aggregateByYear`, `computeTaxBill` are importable from `@livefolio/sdk`.
- [ ] Types `LotSlice`, `TaxRates`, `TaxableIncome` exported.
- [ ] `import { tax } from '@livefolio/sdk'` namespace works.
- [ ] `npm run build` emits the types; `npm run docs:check` passes (the docs site picks up new exports).

**Verify:** `npm run build && npm test`

**Steps:**

- [ ] **Step 1: Add to `src/index.ts`:**

```ts
// Tax utilities — flat exports (canonical) and namespace alias.
export {
  holdingPeriodDays, isLongTerm, realize,
  selectFIFO, selectLIFO, selectHIFO, selectMinTax,
  bucketByTerm, netWithinBucket, crossOffset, aggregateByYear, computeTaxBill, ORDINARY_OFFSET_CAP,
} from './tax';
export type { LotSlice, TaxRates, TaxableIncome, RealizeResult } from './tax';
export * as tax from './tax';
```

- [ ] **Step 2: Build + docs check + commit**

```bash
npm run build && npm test && npm run docs:check
git add src/index.ts
git commit -m "feat(sdk): re-export tax/ arithmetic + tax namespace"
```

> **PR2 done.** Review checkpoint. (Note: `npm run docs:check` is required — `npm test`/`npm run build` do not cover `scripts/docs/` samples and CI's `docs-deploy.yml` runs it separately.)

---

## PR3 — Cash events

### Task 9: `CashEvent` type + `RunBacktestOptions.cashEvents`

**Goal:** Define `CashEvent` and thread it into the options surface (no loop wiring yet).

**Files:**
- Modify: `src/strategy/run-backtest.ts`, `src/strategy/index.ts`, `src/index.ts`
- Test: `src/strategy/cash-event.test.ts`

**Acceptance Criteria:**
- [ ] `CashEvent = { t: Date; delta: number; reason?: 'deposit' | 'withdrawal' | 'interest' | 'dividend' }` exported from `run-backtest.ts`.
- [ ] `RunBacktestOptions.cashEvents?: readonly CashEvent[]` (optional).
- [ ] Re-exported from `src/strategy/index.ts` and `src/index.ts`.
- [ ] Type-only test compiles for valid events and threads through options.

**Verify:** `npm test cash-event`

**Steps:**

- [ ] **Step 1: Add type + option** in `run-backtest.ts` (near `RunBacktestOptions`):

```ts
/**
 * A scheduled cash injection or withdrawal applied at the start of the matching
 * session, BEFORE universe/features/build. Events with `t <= sessionT` that
 * have not yet been consumed are applied (and summed) on that session.
 */
export type CashEvent = {
  t: Date;
  /** Positive = deposit, negative = withdrawal. */
  delta: number;
  reason?: 'deposit' | 'withdrawal' | 'interest' | 'dividend';
};
```

  Add to `RunBacktestOptions`:

```ts
  /** Optional scheduled deposits/withdrawals. Applied per-session before the strategy runs. */
  cashEvents?: readonly CashEvent[];
```

- [ ] **Step 2: Re-export** `CashEvent` from `src/strategy/index.ts` and add to the strategy type block in `src/index.ts`.

- [ ] **Step 3: Type test `src/strategy/cash-event.test.ts`** (per issue Task 9 — `expectTypeOf` cases).

- [ ] **Step 4: Run + commit.**

```bash
npm test cash-event
git add src/strategy/run-backtest.ts src/strategy/cash-event.test.ts src/strategy/index.ts src/index.ts
git commit -m "feat(sdk): CashEvent type on RunBacktestOptions"
```

---

### Task 10: Apply cash events in the backtest loop + `BacktestSnapshot.cashFlow`

**Goal:** Drain due cash events at the start of each session, credit `portfolio.cash`, and record `cashFlow` on the snapshot.

**Files:**
- Create: `src/strategy/apply-cash-events.ts`, `src/strategy/apply-cash-events.test.ts`
- Modify: `src/strategy/run-backtest.ts` (loop + `BacktestSnapshot`)
- Modify: `src/strategy/run-backtest.test.ts`

**Acceptance Criteria:**
- [ ] `BacktestSnapshot.cashFlow?: number` added (in `run-backtest.ts`).
- [ ] In the session loop, events sorted by `t` are drained with a cursor: all with `t <= sessionT` are summed into `cashFlow` and added to `portfolio.cash` **before** `universe`.
- [ ] `cashFlow` is set on the snapshot only when non-zero.
- [ ] If `cash` goes negative, emit a single `console.warn` with the ISO session date (force-sell deferred — documented).
- [ ] Integration test: start 10k, deposit 1k on/just-before the 5th session → snapshot #5 has `cashFlow: 1000` and cash reflects it.

**Verify:** `npm test apply-cash-events && npm test run-backtest`

**Steps:**

- [ ] **Step 1: `src/strategy/apply-cash-events.ts`** — a tiny pure helper for unit clarity (cursor logic lives in the loop):

```ts
import type { CashEvent } from './run-backtest';

/** Sum the deltas of all events with `t <= sessionT`. Pure. */
export function dueCashFlow(events: readonly CashEvent[], sessionT: Date): number {
  let sum = 0;
  for (const e of events) if (e.t.getTime() <= sessionT.getTime()) sum += e.delta;
  return sum;
}
```

- [ ] **Step 2: Tests** for `dueCashFlow` (no due, summing same-t, future excluded).

- [ ] **Step 3: Add `cashFlow` to `BacktestSnapshot`** (after `fills`):

```ts
  /** Net cash delta applied this session via `cashEvents`. Omitted when zero. */
  cashFlow?: number;
```

- [ ] **Step 4: Wire the loop** in `runBacktest`. Before the `for (const t of sessions)` loop:

```ts
  const cashEvents = [...(opts.cashEvents ?? [])].sort((a, b) => a.t.getTime() - b.t.getTime());
  let eventCursor = 0;
```

  At the top of the loop body (before `strategy.universe`):

```ts
    let cashFlow = 0;
    while (eventCursor < cashEvents.length && cashEvents[eventCursor]!.t.getTime() <= t.getTime()) {
      cashFlow += cashEvents[eventCursor]!.delta;
      eventCursor++;
    }
    if (cashFlow !== 0) {
      portfolio = { ...portfolio, cash: portfolio.cash + cashFlow };
      if (portfolio.cash < 0) {
        console.warn(`[runBacktest] cash went negative at ${t.toISOString()}: ${portfolio.cash}`);
      }
    }
```

  When pushing the snapshot, spread the cashFlow conditionally:

```ts
    snapshots.push({ t, portfolio, orders, fills, ...(cashFlow !== 0 ? { cashFlow } : {}) });
```

- [ ] **Step 5: Integration test** in `run-backtest.test.ts` — use the existing mock-feed harness pattern; assert snapshot #5 `cashFlow === 1000`.

- [ ] **Step 6: Run + commit.**

```bash
npm test apply-cash-events && npm test run-backtest && npm test parity
git add src/strategy/apply-cash-events.ts src/strategy/apply-cash-events.test.ts src/strategy/run-backtest.ts src/strategy/run-backtest.test.ts
git commit -m "feat(sdk): apply cashEvents per-session; BacktestSnapshot.cashFlow"
```

---

### Task 11: `runLive` cash events — seed + injectable `CashEventQueue` + `LiveEvent` 'cash'

**Goal:** Mirror cash events in live mode **without changing `runLive`'s return type**. Seed via `RunLiveOptions.cashEvents`; allow dynamic scheduling via an optional injected `CashEventQueue`; emit a new `{ type: 'cash' }` `LiveEvent` at each session close.

**Files:**
- Modify: `src/strategy/run-live.ts`
- Modify: `src/strategy/run-live.test.ts`
- Modify: `src/strategy/index.ts`, `src/index.ts` (export `CashEventQueue`)

**Acceptance Criteria:**
- [ ] `class CashEventQueue { push(e: CashEvent): void; drainDue(now: Date): CashEvent[] }` exported; `drainDue` removes and returns events with `t <= now`.
- [ ] `RunLiveOptions.cashEvents?: readonly CashEvent[]` (pre-seeded) and `RunLiveOptions.cashEventQueue?: CashEventQueue` (dynamic).
- [ ] `LiveEvent` union gains `{ type: 'cash'; t: Date; delta: number; reason?: CashEvent['reason'] }`.
- [ ] On each **session-close** step, due events (seed + queue) are summed, applied to `portfolio.cash`, and a `cash` event is yielded before the `snapshot` event.
- [ ] Return type stays `AsyncIterable<LiveEvent>` — non-breaking.

**Verify:** `npm test run-live`

**Steps:**

- [ ] **Step 1: Add `CashEventQueue`** (top of `run-live.ts`):

```ts
import type { CashEvent } from './run-backtest';

/**
 * Mutable queue for scheduling {@link CashEvent}s into a running `runLive`
 * stream. Construct one, pass it via {@link RunLiveOptions.cashEventQueue},
 * and `push` events from outside the generator — they are drained at each
 * session close. Non-breaking alternative to a returned handle.
 */
export class CashEventQueue {
  private pending: CashEvent[] = [];
  push(e: CashEvent): void { this.pending.push(e); }
  /** Remove and return events with `t <= now`. */
  drainDue(now: Date): CashEvent[] {
    const due = this.pending.filter((e) => e.t.getTime() <= now.getTime());
    this.pending = this.pending.filter((e) => e.t.getTime() > now.getTime());
    return due;
  }
}
```

- [ ] **Step 2: Extend `LiveEvent` union** — add a third arm:

```ts
  | { type: 'cash'; t: Date; delta: number; reason?: CashEvent['reason'] }
```

- [ ] **Step 3: Extend `RunLiveOptions`** with `cashEvents?: readonly CashEvent[]` and `cashEventQueue?: CashEventQueue`.

- [ ] **Step 4: Seed + drain.** Inside `runLive`, before the tick loop, build a seed queue:

```ts
  const seedQueue = new CashEventQueue();
  for (const e of opts.cashEvents ?? []) seedQueue.push(e);
```

  In the **session-close** branch (where the `snapshot` event is produced — read the existing structure around `yield { ... type: 'snapshot' }`), before applying fills/yielding the snapshot:

```ts
    const now = /* session close timestamp already in scope */;
    const due = [...seedQueue.drainDue(now), ...(opts.cashEventQueue?.drainDue(now) ?? [])];
    const delta = due.reduce((s, e) => s + e.delta, 0);
    if (delta !== 0) {
      portfolio = { ...portfolio, cash: portfolio.cash + delta };
      yield { type: 'cash', t: now, delta, reason: due[0]?.reason };
    }
```

  (Adapt variable names to the existing `run-live.ts` session-close locals; the key is: apply before the `snapshot` portfolio is captured.)

- [ ] **Step 5: Test** — pre-seed one event 5 minutes out + push one via an injected queue; advance the streaming clock past a session close; assert a `cash` event with the summed delta is emitted and `portfolio.cash` reflects it.

- [ ] **Step 6: Export + commit.**

```bash
npm test run-live
git add src/strategy/run-live.ts src/strategy/run-live.test.ts src/strategy/index.ts src/index.ts
git commit -m "feat(sdk): runLive cashEvents seed + CashEventQueue + LiveEvent 'cash'"
```

> **PR3 done.** Review checkpoint.

---

## PR4 — DataFeed contract + executor lots

### Task 12: `DataFeed.bars(kind?)` + `RoutingDataFeed` passthrough

**Goal:** Add the optional `kind: 'adjusted' | 'unadjusted'` param (default `'adjusted'`) to `DataFeed.bars` and proxy it through `RoutingDataFeed`. Non-breaking.

**Files:**
- Modify: `src/interfaces/data-feed.ts`
- Modify: `src/reference/routing-data-feed.ts`, `src/reference/routing-data-feed.test.ts`

**Acceptance Criteria:**
- [ ] `bars(asset, range, freq, kind?: 'adjusted' | 'unadjusted'): AsyncIterable<Bar>` with TSDoc noting default `'adjusted'` and that indicators use adjusted, execution/dividends use unadjusted.
- [ ] `RoutingDataFeed.bars` accepts + forwards `kind`.
- [ ] Existing 3-arg callers still compile and behave identically.
- [ ] Test: a stub feed returning different closes per `kind` is routed correctly for both.

**Verify:** `npm test routing-data-feed && npm run build`

**Steps:**

- [ ] **Step 1: Edit the interface** in `data-feed.ts` — change the `bars` signature and extend its TSDoc:

```ts
  bars(asset: Asset, range: DateRange, freq: Frequency, kind?: 'adjusted' | 'unadjusted'): AsyncIterable<Bar>;
```

- [ ] **Step 2: Edit `RoutingDataFeed.bars`**:

```ts
  async *bars(asset: Asset, range: DateRange, freq: Frequency, kind?: 'adjusted' | 'unadjusted'): AsyncGenerator<Bar> {
    const feed = this.resolve(asset);
    yield* feed.bars(asset, range, freq, kind);
  }
```

- [ ] **Step 3: Test** — stub feed whose `bars` yields `close: kind === 'unadjusted' ? 100 : 95`; route equity to it; assert both kinds.

- [ ] **Step 4: Commit.**

```bash
npm test routing-data-feed && npm run build
git add src/interfaces/data-feed.ts src/reference/routing-data-feed.ts src/reference/routing-data-feed.test.ts
git commit -m "feat(sdk): DataFeed.bars(kind?) adjusted/unadjusted + routing passthrough"
```

---

### Task 13: `DividendEvent` type + `DataFeed.dividends?` + routing proxy

**Goal:** Add the dividend surface (types + optional method) and route it, throwing a clear error for feeds that lack it.

**Files:**
- Modify: `src/interfaces/types.ts` (add `DividendEvent`)
- Modify: `src/interfaces/data-feed.ts` (add optional method)
- Modify: `src/interfaces/index.ts`, `src/index.ts` (export `DividendEvent`)
- Modify: `src/reference/routing-data-feed.ts`, `src/reference/routing-data-feed.test.ts`

**Acceptance Criteria:**
- [ ] `DividendEvent = { asset; exDate; payDate; amountPerShare; incomeKind: 'qualified-eligible' | 'ordinary' | 'interest' }` in `interfaces/types.ts` with TSDoc (note: `'qualified-eligible'` means "eligible if the per-lot holding-period test passes").
- [ ] `DataFeed.dividends?(asset, range): Promise<DividendEvent[]>`.
- [ ] `RoutingDataFeed.dividends(asset, range)` resolves the routed feed and throws `RoutingDataFeedError("...does not implement dividends()")` when absent; otherwise delegates.
- [ ] `DividendEvent` re-exported from `src/index.ts`.

**Verify:** `npm test routing-data-feed`

**Steps:**

- [ ] **Step 1: Add `DividendEvent`** to `interfaces/types.ts` (after `DataEvent`):

```ts
/**
 * A cash distribution (dividend) or interest payment for an asset, with the
 * info the SDK needs to credit cash and classify the income per-lot.
 *
 * `incomeKind: 'qualified-eligible'` means the distribution *can* be qualified
 * if a holding lot satisfies the 60-of-121-day rule; the runtime resolves the
 * actual qualified-vs-ordinary split per lot. `'ordinary'`/`'interest'` are
 * never qualified.
 */
export type DividendEvent = {
  asset: Asset;
  exDate: Date;
  payDate: Date;
  amountPerShare: number;
  incomeKind: 'qualified-eligible' | 'ordinary' | 'interest';
};
```

  (`Asset` is already imported in `types.ts`.)

- [ ] **Step 2: Add the optional method** to `DataFeed` in `data-feed.ts` (import `DividendEvent` from `./types`):

```ts
  /**
   * Returns cash distributions for `asset` over `range`. Optional — providers
   * without dividend data omit it. Used by `runBacktest`'s dividend hook.
   */
  dividends?(asset: Asset, range: DateRange): Promise<DividendEvent[]>;
```

- [ ] **Step 3: Add the routing proxy** in `routing-data-feed.ts`:

```ts
  async dividends(asset: Asset, range: DateRange): Promise<DividendEvent[]> {
    const feed = this.resolve(asset);
    if (typeof feed.dividends !== 'function') {
      throw new RoutingDataFeedError(
        `RoutingDataFeed: routed feed for asset.kind="${asset.kind}" (id="${asset.id}") does not implement dividends()`,
      );
    }
    return feed.dividends(asset, range);
  }
```

  (Import `DividendEvent` type.)

- [ ] **Step 4: Export** from `interfaces/index.ts` and `src/index.ts` (add `DividendEvent` to the interfaces type block).

- [ ] **Step 5: Tests** — routed feed with `dividends` returns events; routed feed without throws.

- [ ] **Step 6: Commit.**

```bash
npm test routing-data-feed && npm run build
git add src/interfaces/types.ts src/interfaces/data-feed.ts src/interfaces/index.ts src/reference/routing-data-feed.ts src/reference/routing-data-feed.test.ts src/index.ts
git commit -m "feat(sdk): DividendEvent + DataFeed.dividends? + routing proxy"
```

---

### Task 14: `BacktestExecutor.lotMethod` — split sell fills per lot

**Goal:** When a `lotMethod` is configured, split sell orders into per-lot fills carrying `lotId` using the tax selectors. Default (no `lotMethod`/`'FIFO'`) keeps today's single-fill behavior so parity holds and `applyFills` does internal FIFO.

**Files:**
- Modify: `src/reference/backtest-executor.ts`, `src/reference/backtest-executor.test.ts`

**Acceptance Criteria:**
- [ ] `BacktestExecutorOptions` grows `lotMethod?: 'FIFO' | 'LIFO' | 'HIFO' | 'min-tax'` and `taxRates?: { shortTerm; longTerm }`.
- [ ] Constructor throws if `lotMethod === 'min-tax'` and `taxRates` is missing.
- [ ] When `lotMethod` is undefined or `'FIFO'`: behavior is **identical to today** — one fill per order, no `lotId` (parity-safe). `applyFills` then does FIFO internally.
- [ ] When `lotMethod` is `'LIFO'`/`'HIFO'`/`'min-tax'`: a sell (`rebalance` with `delta < 0`, or `close` of a long position) is split into one fill per selected `LotSlice`, each carrying `lotId` and that slice's `quantity`, all at the same next-open price. Sum of slice quantities equals the order quantity.
- [ ] Buys and short/adjust orders are unchanged.
- [ ] Test: same sell, `lotMethod: 'HIFO'` vs default → different `lotId`-bearing fills; downstream `applyFills` realized events differ in basis; final cash + total remaining long quantity match across methods.

**Verify:** `npm test backtest-executor && npm test parity`

**Steps:**

- [ ] **Step 1: Extend options + guard** in the constructor:

```ts
import { selectFIFO, selectLIFO, selectHIFO, selectMinTax, type LotSlice } from '../tax/lot-selection';
// add to BacktestExecutorOptions:
//   lotMethod?: 'FIFO' | 'LIFO' | 'HIFO' | 'min-tax';
//   taxRates?: { shortTerm: number; longTerm: number };

constructor(private readonly opts: BacktestExecutorOptions) {
  if (opts.lotMethod === 'min-tax' && !opts.taxRates) {
    throw new Error("BacktestExecutor: lotMethod 'min-tax' requires taxRates");
  }
}
```

- [ ] **Step 2: Determine sells + split.** In `submit`, after computing `{ asset, sign, qty }`:

```ts
      const open = await this.opts.nextOpen(asset, t);
      const adjustedPrice = open.price * (1 + sign * slip);
      const method = this.opts.lotMethod;
      const isSell = sign < 0;
      if (isSell && method && method !== 'FIFO') {
        const lots = (portfolio.lots ?? []).filter((l) => l.asset.id === asset.id && l.quantity > 0);
        const slices: LotSlice[] =
          method === 'LIFO' ? selectLIFO(lots, qty)
          : method === 'HIFO' ? selectHIFO(lots, qty)
          : selectMinTax(lots, qty, { price: adjustedPrice, asOf: open.t, rates: this.opts.taxRates! });
        for (const s of slices) {
          fills.push({ orderRef: order.id, t: open.t, quantity: s.quantity, price: adjustedPrice, fees: feePer * s.quantity, lotId: s.lotId });
        }
        continue;
      }
      fills.push({ orderRef: order.id, t: open.t, quantity: qty, price: adjustedPrice, fees: feePer * qty });
```

- [ ] **Step 3: Tests** — construct a portfolio with two lots of different basis; sell crossing both; assert HIFO selects the higher-basis lot first via the emitted `lotId`s, and that `applyFills` consuming them yields the expected realized basis. Add a min-tax-without-rates constructor-throw test.

- [ ] **Step 4: Commit.**

```bash
npm test backtest-executor && npm test parity
git add src/reference/backtest-executor.ts src/reference/backtest-executor.test.ts
git commit -m "feat(sdk): BacktestExecutor.lotMethod splits sells into per-lot fills"
```

---

### Task 15: Re-export executor option types + smoke

**Goal:** Ensure `BacktestExecutorOptions` (now with `lotMethod`/`taxRates`) and `DividendEvent` are documented on the package root; run a small end-to-end smoke.

**Files:**
- Modify: `src/index.ts` (verify exports), add a smoke test if helpful

**Acceptance Criteria:**
- [ ] `npm run build` clean; `npm run docs:check` passes.
- [ ] A smoke backtest with `executor = new BacktestExecutor({ calendar, nextOpen, lotMethod: 'HIFO', taxRates: { shortTerm: 0.37, longTerm: 0.2 } })` runs and produces `realized` events on sells.

**Verify:** `npm test && npm run build && npm run docs:check`

**Steps:**

- [ ] **Step 1:** Confirm `BacktestExecutorOptions` is already re-exported (it is, line 55 of `index.ts`); no code change needed beyond verifying TSDoc renders.
- [ ] **Step 2:** Optional smoke test in `src/strategy/run-backtest.test.ts` using the HIFO executor; assert non-empty `finalPortfolio.realized` after a sell.
- [ ] **Step 3: Commit** (if a smoke test was added).

```bash
npm test && npm run build && npm run docs:check
git commit -am "test(sdk): HIFO executor end-to-end smoke" || true
```

> **PR4 done.** Review checkpoint. (yfinance adapter changes — issue Task 27 — are tracked in `livefolio/yfinance#4` and are **out of scope** for this SDK plan; the SDK only ships the new interface + routing proxy.)

---

## PR5 — Dividends + cash interest

### Task 16: `tax/dividends.ts` — `isQualifiedForLot` + `distributeDividend`

**Goal:** Pure utilities to split a dividend across held lots and classify qualified vs ordinary per lot (60-of-121 rule).

**Files:**
- Create: `src/tax/dividends.ts`, `src/tax/dividends.test.ts`
- Modify: `src/tax/index.ts`

**Acceptance Criteria:**
- [ ] `isQualifiedForLot(lot, exDate, opts?)` — `opts.holdingDaysRequired` default `61`, `opts.windowDays` default `121`; computes days held within the 121-day window centered on `exDate` (capped at `exDate`), returns `days >= required`.
- [ ] `distributeDividend(event, lotsHeldAtExDate)` → `{ totals: { qualified; ordinary }; perLot: { lotId; cash; qualified }[] }`; only lots with `quantity > 0`, `openDate <= exDate`, and matching `asset.id` participate.
- [ ] `incomeKind: 'ordinary' | 'interest'` events → all `qualified: false`; `'qualified-eligible'` → per-lot test.

**Verify:** `npm test tax/dividends`

**Steps:**

- [ ] **Step 1: Tests** — short-held lot (10d) not qualified; long-held (90d) qualified; `'ordinary'` event all-false; lot opened after ex-date excluded; mixed group split.

- [ ] **Step 2: Implement** (issue Task 28 code is correct; reproduced):

```ts
import type { Lot } from '../portfolio/types';
import type { DividendEvent } from '../interfaces/types';

const MS_PER_DAY = 86_400_000;

export type QualificationOpts = { holdingDaysRequired?: number; windowDays?: number };

export function isQualifiedForLot(lot: Lot, exDate: Date, opts: QualificationOpts = {}): boolean {
  const required = opts.holdingDaysRequired ?? 61;
  const window = opts.windowDays ?? 121;
  const half = Math.floor(window / 2);
  const windowStart = new Date(exDate.getTime() - half * MS_PER_DAY);
  const windowEnd = new Date(exDate.getTime() + half * MS_PER_DAY);
  const heldFrom = lot.openDate > windowStart ? lot.openDate : windowStart;
  const heldTo = exDate < windowEnd ? exDate : windowEnd;
  const days = Math.max(0, (heldTo.getTime() - heldFrom.getTime()) / MS_PER_DAY);
  return days >= required;
}

export type DividendDistribution = {
  totals: { qualified: number; ordinary: number };
  perLot: { lotId: string; cash: number; qualified: boolean }[];
};

export function distributeDividend(event: DividendEvent, lotsHeldAtExDate: readonly Lot[]): DividendDistribution {
  const eligible = event.incomeKind === 'qualified-eligible';
  const perLot: DividendDistribution['perLot'] = [];
  let qualified = 0, ordinary = 0;
  for (const lot of lotsHeldAtExDate) {
    if (lot.quantity <= 0 || lot.openDate > event.exDate || lot.asset.id !== event.asset.id) continue;
    const cash = lot.quantity * event.amountPerShare;
    const isQ = eligible && isQualifiedForLot(lot, event.exDate);
    perLot.push({ lotId: lot.id, cash, qualified: isQ });
    if (isQ) qualified += cash; else ordinary += cash;
  }
  return { totals: { qualified, ordinary }, perLot };
}
```

- [ ] **Step 3: Re-export + run + commit.**

```bash
npm test tax/dividends
git add src/tax/dividends.ts src/tax/dividends.test.ts src/tax/index.ts
git commit -m "feat(sdk/tax): distributeDividend + isQualifiedForLot"
```

---

### Task 17: `tax/dividends.ts` — `reinvestDividend` (DRIP lot)

**Goal:** Pure helper to turn dividend cash into a new whole-share lot at the pay-date price, with `dripParent` set.

**Files:**
- Modify: `src/tax/dividends.ts`, `src/tax/dividends.test.ts`

**Acceptance Criteria:**
- [ ] `reinvestDividend(cashAvailable, asset, pricePayDate, payDate, dripParent)` → `{ newLot: Lot; residual: number }`; `shares = floor(cash / price)`; `openDate = payDate`; `basis = shares * price`; `dripParent` set; `residual = cash - basis`.
- [ ] `shares === 0` (cash < one share) → `newLot.quantity === 0`, `residual === cashAvailable` (caller skips zero-qty lots).

**Verify:** `npm test tax/dividends`

**Steps:**

- [ ] **Step 1: Tests** — $1000 cash @ $300 → 3 shares, residual $100, openDate = payDate, dripParent set; $50 @ $300 → 0 shares, residual $50.

- [ ] **Step 2: Implement** (uses `nextLotId`, not `nanoid`):

```ts
import { nextLotId } from '../portfolio/ids';
import type { Asset } from '../interfaces/types';

export function reinvestDividend(
  cashAvailable: number,
  asset: Asset,
  pricePayDate: number,
  payDate: Date,
  dripParent: string,
): { newLot: Lot; residual: number } {
  const shares = Math.floor(cashAvailable / pricePayDate);
  const cost = shares * pricePayDate;
  return {
    newLot: { id: nextLotId(), asset, quantity: shares, openDate: payDate, openPrice: pricePayDate, basis: cost, dripParent },
    residual: cashAvailable - cost,
  };
}
```

- [ ] **Step 3: Run + commit.**

```bash
npm test tax/dividends
git add src/tax/dividends.ts src/tax/dividends.test.ts
git commit -m "feat(sdk/tax): reinvestDividend creates a fresh-clock DRIP lot"
```

---

### Task 18: `tax/cash-interest.ts`

**Goal:** Pure daily interest accrual helper.

**Files:**
- Create: `src/tax/cash-interest.ts`, `src/tax/cash-interest.test.ts`
- Modify: `src/tax/index.ts`

**Acceptance Criteria:**
- [ ] `accrueCashInterest(cash, dailyRate)` → `{ newCash: cash + cash*dailyRate; interest: cash*dailyRate }`.
- [ ] Test: 5% APY ÷ 365 over 365 sessions on $10k ≈ $500 (within tolerance).

**Verify:** `npm test cash-interest`

**Steps:**

- [ ] **Step 1: Test** — loop 365 sessions at `0.05/365`, assert `~500`.
- [ ] **Step 2: Implement:**

```ts
/** Simple per-session interest accrual. `dailyRate` is APY/365 for actual/365. */
export function accrueCashInterest(cash: number, dailyRate: number): { newCash: number; interest: number } {
  const interest = cash * dailyRate;
  return { newCash: cash + interest, interest };
}
```

- [ ] **Step 3: Re-export + commit.**

```bash
npm test cash-interest
git add src/tax/cash-interest.ts src/tax/cash-interest.test.ts src/tax/index.ts
git commit -m "feat(sdk/tax): accrueCashInterest"
```

---

### Task 19: runBacktest dividend hook (cash + DRIP) + `dividendIncome` snapshot

**Goal:** Pre-fetch dividends for the universe; per session, apply matching `exDate` dividends to lots — credit cash (or DRIP), append `RealizedEvent`s, set `BacktestSnapshot.dividendIncome`.

**Files:**
- Modify: `src/strategy/run-backtest.ts`, `src/strategy/run-backtest.test.ts`

**Acceptance Criteria:**
- [ ] `DividendsConfig = { reinvest: boolean }` exported from `run-backtest.ts`; `RunBacktestOptions.dividends?: DividendsConfig` (default behavior = no dividends applied unless `dataFeed.dividends` exists; reinvest defaults false).
- [ ] When `dataFeed.dividends` exists, pre-fetch events for each asset in the initial universe (`strategy.universe(sessions[0], initialPortfolio)`) over `opts.range`, cached by asset id. Document the static-universe assumption.
- [ ] Per session, events with `exDate.getTime() === t.getTime()` → `distributeDividend(div, portfolio.lots ?? [])`:
  - Cash mode: credit `totals.qualified + totals.ordinary` to `cash`.
  - DRIP mode (`reinvest: true`): per perLot slice, fetch the **unadjusted** pay-date price via `dataFeed.bars(asset, {from: payDate, to: payDate+1d}, freq, 'unadjusted')`, call `reinvestDividend`, push the new lot (skip zero-share), credit only residuals.
- [ ] Each perLot slice → one `RealizedEvent` `{ quantity: 0, basis: 0, proceeds: cash, gain: cash, incomeKind: slice.qualified ? 'qualified-dividend' : 'ordinary-dividend', termType: 'long' }`.
- [ ] `BacktestSnapshot.dividendIncome?: { qualified; ordinary }` set when non-zero.
- [ ] This hook runs **after** cash events, **before** universe (so the cash is available to the build).
- [ ] Integration test: a mock feed with `dividends()` returning one event mid-range over a held SPY lot → snapshot shows the credit; DRIP mode adds a lot.

**Verify:** `npm test run-backtest`

**Steps:**

- [ ] **Step 1: Add `DividendsConfig` + `dividendIncome`/`interestIncome` to `BacktestSnapshot`** (interest field is populated in Task 20):

```ts
/** How dividends are handled during a backtest. `reinvest: true` enables DRIP. */
export type DividendsConfig = { reinvest: boolean };
```

Add `dividends?: DividendsConfig` to `RunBacktestOptions`, re-export `DividendsConfig` from `strategy/index.ts` + `index.ts`, and add to `BacktestSnapshot`:

```ts
  /** Dividend income recognized this session, split by qualified status. Omitted when zero. */
  dividendIncome?: { qualified: number; ordinary: number };
  /** Interest income accrued on cash this session. Omitted when zero. */
  interestIncome?: number;
```

- [ ] **Step 2: Pre-fetch** at the top of `runBacktest` (after computing `sessions`, before the loop):

```ts
  const divByAsset = new Map<string, DividendEvent[]>();
  if (opts.dataFeed.dividends && sessions.length > 0) {
    const u0 = opts.strategy.universe(sessions[0]!, opts.initialPortfolio);
    for (const asset of u0) {
      divByAsset.set(asset.id, await opts.dataFeed.dividends(asset, opts.range));
    }
  }
  const allDivs = [...divByAsset.values()].flat();
```

  (Import `DividendEvent` and `distributeDividend`/`reinvestDividend`; declare a `collectBar`-style helper to read a single unadjusted bar — see Step 3.)

- [ ] **Step 3: Per-session apply** — inside the loop, after the cash-events block, before `strategy.universe`:

```ts
    let qualifiedTotal = 0, ordinaryTotal = 0;
    const todaysDivs = allDivs.filter((e) => e.exDate.getTime() === t.getTime());
    for (const div of todaysDivs) {
      const dist = distributeDividend(div, portfolio.lots ?? []);
      if (dist.perLot.length === 0) continue;
      qualifiedTotal += dist.totals.qualified;
      ordinaryTotal += dist.totals.ordinary;
      const reinvest = opts.dividends?.reinvest === true;
      let lots = [...(portfolio.lots ?? [])];
      const realized = [...(portfolio.realized ?? [])];
      let cashCredit = 0;
      for (const slice of dist.perLot) {
        realized.push({
          asset: div.asset, lotId: slice.lotId, quantity: 0,
          openDate: t, closeDate: t, proceeds: slice.cash, basis: 0,
          termType: 'long', gain: slice.cash,
          incomeKind: slice.qualified ? 'qualified-dividend' : 'ordinary-dividend',
        });
        if (reinvest) {
          const price = await firstUnadjustedClose(opts.dataFeed, div.asset, div.payDate, opts.freq ?? '1d');
          if (price && price > 0) {
            const { newLot, residual } = reinvestDividend(slice.cash, div.asset, price, div.payDate, slice.lotId);
            if (newLot.quantity > 0) lots.push(newLot);
            cashCredit += residual;
          } else {
            cashCredit += slice.cash; // no price → fall back to cash
          }
        } else {
          cashCredit += slice.cash;
        }
      }
      portfolio = { ...portfolio, cash: portfolio.cash + cashCredit, lots, realized };
    }
```

  Add a module-level helper:

```ts
async function firstUnadjustedClose(feed: DataFeed, asset: Asset, payDate: Date, freq: Frequency): Promise<number | undefined> {
  const to = new Date(payDate.getTime() + 86_400_000);
  for await (const bar of feed.bars(asset, { from: payDate, to }, freq, 'unadjusted')) return bar.close;
  return undefined;
}
```

- [ ] **Step 4: Snapshot** — extend the push to include `dividendIncome` when non-zero:

```ts
    const dividendIncome = qualifiedTotal + ordinaryTotal > 0 ? { qualified: qualifiedTotal, ordinary: ordinaryTotal } : undefined;
    snapshots.push({ t, portfolio, orders, fills, ...(cashFlow !== 0 ? { cashFlow } : {}), ...(dividendIncome ? { dividendIncome } : {}) });
```

- [ ] **Step 5: Integration tests** — mock feed exposing `dividends()` + `bars(...,'unadjusted')`; (a) cash mode credits, (b) reinvest mode adds a DRIP lot with `dripParent` set.

- [ ] **Step 6: Commit.**

```bash
npm test run-backtest && npm test parity
git add src/strategy/run-backtest.ts src/strategy/run-backtest.test.ts
git commit -m "feat(sdk): runBacktest dividend hook (cash + DRIP) + dividendIncome"
```

---

### Task 20: runBacktest `cashYield` option + interest accrual + `interestIncome`

**Goal:** Accrue daily interest on idle cash per `cashYield`, append `interest` `RealizedEvent`s, and set `BacktestSnapshot.interestIncome`.

**Files:**
- Modify: `src/strategy/run-backtest.ts`, `src/strategy/run-backtest.test.ts`

**Acceptance Criteria:**
- [ ] `RunBacktestOptions.cashYield?: CashYieldConfig` (default `{ kind: 'none' }`); `CashYieldConfig` exported (Task 9 file or here).
- [ ] Per session, after dividends, before universe: resolve a daily rate — `flat` → `apy/365`; `tbill` → fetch the configured (or default `T3M`) macro series for `t` and use `(yield - spread)/365`; `none`/`0` → skip.
- [ ] When `dailyRate > 0` and `cash > 0`: `accrueCashInterest`, add interest to cash, push a `RealizedEvent` `{ incomeKind: 'interest', proceeds: interest, basis: 0, quantity: 0, termType: 'short', asset: CASH_ASSET, lotId: 'cash' }`.
- [ ] `BacktestSnapshot.interestIncome?: number` set when non-zero.
- [ ] Test: flat 5% APY on $10k over ~365 sessions → cumulative interest ≈ $500.

**Verify:** `npm test run-backtest`

**Steps:**

- [ ] **Step 1: Define `CashYieldConfig` + `CASH_ASSET`** (in `run-backtest.ts`):

```ts
export type CashYieldConfig =
  | { kind: 'none' }
  | { kind: 'flat'; apy: number }
  | { kind: 'tbill'; spread: number; assetId?: AssetId };

const CASH_ASSET: Asset = { kind: 'equity', id: '_cash', symbol: 'CASH' };
```

  Add `cashYield?: CashYieldConfig` to `RunBacktestOptions`. Re-export `CashYieldConfig`/`DividendsConfig` from `strategy/index.ts` + `index.ts`.

- [ ] **Step 2: Rate resolver** (module helper):

```ts
async function resolveDailyRate(cfg: CashYieldConfig | undefined, t: Date, feed: DataFeed, freq: Frequency): Promise<number> {
  if (!cfg || cfg.kind === 'none') return 0;
  if (cfg.kind === 'flat') return cfg.apy / 365;
  const id = cfg.assetId ?? 'DGS3MO';
  const asset: Asset = { kind: 'macro', id, symbol: id, source: 'FRED' };
  const to = new Date(t.getTime() + 86_400_000);
  let last: number | undefined;
  for await (const bar of feed.bars(asset, { from: new Date(t.getTime() - 7 * 86_400_000), to }, freq, 'unadjusted')) last = bar.close;
  if (last === undefined) return 0;
  return Math.max(0, (last / 100 - cfg.spread) / 365); // FRED yields are percentages
}
```

- [ ] **Step 3: Wire into the loop** — after the dividend block:

```ts
    let interestThisSession = 0;
    const dailyRate = await resolveDailyRate(opts.cashYield, t, opts.dataFeed, opts.freq ?? '1d');
    if (dailyRate > 0 && portfolio.cash > 0) {
      const { newCash, interest } = accrueCashInterest(portfolio.cash, dailyRate);
      const realized = [...(portfolio.realized ?? []), {
        asset: CASH_ASSET, lotId: 'cash', quantity: 0, openDate: t, closeDate: t,
        proceeds: interest, basis: 0, termType: 'short' as const, gain: interest, incomeKind: 'interest' as const,
      }];
      portfolio = { ...portfolio, cash: newCash, realized };
      interestThisSession = interest;
    }
```

  Extend the snapshot push with `...(interestThisSession !== 0 ? { interestIncome: interestThisSession } : {})`.

- [ ] **Step 4: Test** — flat APY accumulation ≈ $500; assert an `interest` realized event exists.

- [ ] **Step 5: Commit.**

```bash
npm test run-backtest && npm test parity
git add src/strategy/run-backtest.ts src/strategy/run-backtest.test.ts src/strategy/index.ts src/index.ts
git commit -m "feat(sdk): cashYield option + per-session interest accrual + interestIncome"
```

> **PR5 done.** Review checkpoint. Run the issue's combined integration test (deposit + DRIP + flat APY) here as a sanity check.

---

## PR6 — Tactical pre-passes + wash sale

### Task 21: `tactical/drift-band.ts`

**Goal:** Pure `currentWeights` + `withinDriftBand` utilities.

**Files:**
- Create: `src/tactical/drift-band.ts`, `src/tactical/drift-band.test.ts`
- Modify: `src/tactical/index.ts`

**Acceptance Criteria:**
- [ ] `currentWeights(portfolio, prices)` → `Map<AssetId, number>` from `portfolio.lots ?? []`, each `= (qty*price)/total`, with synthetic `'_cash'` = `cash/total`. `total <= 0` → `Map([['_cash', 1]])`.
- [ ] `withinDriftBand(current, target, band)` → `true` iff `|current_k - target_k| < band` for all keys incl. the cash residual (`max(0, 1 - Σtarget)`).
- [ ] Tests: 60/40 vs 60.0001/39.9999 band 0.05 → true; 65/35 band 0.05 → false.

**Verify:** `npm test drift-band`

**Steps:**

- [ ] **Step 1: Tests** per the acceptance cases.
- [ ] **Step 2: Implement** (issue Task 35 code; reads `portfolio.lots ?? []`):

```ts
import type { AssetId, Portfolio } from '../portfolio/types';
import type { PriceMap, TargetWeights } from '../strategy/reconcile';

const CASH_KEY = '_cash' as AssetId;

export function currentWeights(portfolio: Portfolio, prices: PriceMap): Map<AssetId, number> {
  const byAsset = new Map<AssetId, number>();
  for (const lot of portfolio.lots ?? []) byAsset.set(lot.asset.id, (byAsset.get(lot.asset.id) ?? 0) + lot.quantity);
  let total = portfolio.cash;
  const values = new Map<AssetId, number>();
  for (const [id, qty] of byAsset) {
    const price = prices.get(id);
    if (price === undefined) continue;
    const v = qty * price;
    values.set(id, v);
    total += v;
  }
  if (total <= 0) return new Map([[CASH_KEY, 1]]);
  const out = new Map<AssetId, number>();
  for (const [id, v] of values) out.set(id, v / total);
  out.set(CASH_KEY, portfolio.cash / total);
  return out;
}

export function withinDriftBand(current: ReadonlyMap<AssetId, number>, target: TargetWeights, band: number): boolean {
  const keys = new Set<AssetId>([...current.keys(), ...target.keys(), CASH_KEY]);
  const tgtSum = Array.from(target.values()).reduce((s, v) => s + v, 0);
  const targetCash = Math.max(0, 1 - tgtSum);
  for (const k of keys) {
    const c = current.get(k) ?? 0;
    const tw = k === CASH_KEY ? targetCash : target.get(k) ?? 0;
    if (Math.abs(c - tw) >= band) return false;
  }
  return true;
}
```

- [ ] **Step 3: Re-export from `tactical/index.ts` + commit.**

```bash
npm test drift-band
git add src/tactical/drift-band.ts src/tactical/drift-band.test.ts src/tactical/index.ts
git commit -m "feat(sdk/tactical): currentWeights + withinDriftBand"
```

---

### Task 22: `tactical/apply-tax-policy.ts`

**Goal:** Drift-band short-circuit pre-pass over target weights.

**Files:**
- Create: `src/tactical/apply-tax-policy.ts`, `src/tactical/apply-tax-policy.test.ts`
- Modify: `src/tactical/index.ts`

**Acceptance Criteria:**
- [ ] `TaxPolicyConfig = { accountType: 'taxable'|'ira'|'roth'|'401k'; shortTermRate; longTermRate; driftBand?: { threshold } }`.
- [ ] `applyTaxPolicy(target, portfolio, prices, asOf, config?)`: identity when `!config`, `accountType !== 'taxable'`, or no `driftBand`. When `driftBand` set and `withinDriftBand` → return `currentWeights` with `'_cash'` stripped (hold); else return `target`.

**Verify:** `npm test apply-tax-policy`

**Steps:**

- [ ] **Step 1: Tests** — all four branches.
- [ ] **Step 2: Implement** (issue Task 36 code):

```ts
import type { Portfolio } from '../portfolio/types';
import type { PriceMap, TargetWeights } from '../strategy/reconcile';
import { currentWeights, withinDriftBand } from './drift-band';

export type TaxPolicyConfig = {
  accountType: 'taxable' | 'ira' | 'roth' | '401k';
  shortTermRate: number;
  longTermRate: number;
  driftBand?: { threshold: number };
};

export function applyTaxPolicy(
  targetWeights: TargetWeights,
  portfolio: Portfolio,
  prices: PriceMap,
  _asOf: Date,
  config?: TaxPolicyConfig,
): TargetWeights {
  if (!config || config.accountType !== 'taxable' || !config.driftBand) return targetWeights;
  const current = currentWeights(portfolio, prices);
  if (withinDriftBand(current, targetWeights, config.driftBand.threshold)) {
    const stripped = new Map(current);
    stripped.delete('_cash');
    return stripped;
  }
  return targetWeights;
}
```

- [ ] **Step 3: Re-export + commit.**

```bash
npm test apply-tax-policy
git add src/tactical/apply-tax-policy.ts src/tactical/apply-tax-policy.test.ts src/tactical/index.ts
git commit -m "feat(sdk/tactical): applyTaxPolicy drift-band short-circuit"
```

---

### Task 23: `tactical/apply-tax-loss-harvest.ts`

**Goal:** Opt-in TLH pre-pass: swap held losers into a caller-provided wash-safe pair when unrealized loss exceeds a threshold and no recent buy would wash the re-entry.

**Files:**
- Create: `src/tactical/apply-tax-loss-harvest.ts`, `src/tactical/apply-tax-loss-harvest.test.ts`
- Modify: `src/tactical/index.ts`

**Acceptance Criteria:**
- [ ] `TLHConfig = { enabled; minLossThreshold; cooldownDays; swapPairs: Record<string,string> }`; result `{ weights; swaps: { from; to; expectedLoss }[] }`.
- [ ] `!enabled` → identity. For each held asset with aggregate unrealized loss `> minLossThreshold` and a `swapPairs[id]` target and no buy of `id` within `cooldownDays` of `asOf` in `recentBuyHistory`: move its target weight to the swap target, delete the original, record the swap.

**Verify:** `npm test apply-tax-loss-harvest`

**Steps:**

- [ ] **Step 1: Tests** — $1500 loss + $500 threshold + valid pair → swap; threshold $5000 → none; missing pair → none; recent buy within cooldown → none.
- [ ] **Step 2: Implement** (issue Task 43 code; `recentBuyHistory` items are `{ assetId; t }`):

```ts
import type { AssetId, Portfolio } from '../portfolio/types';
import type { PriceMap, TargetWeights } from '../strategy/reconcile';

const MS_PER_DAY = 86_400_000;

export type TLHConfig = { enabled: boolean; minLossThreshold: number; cooldownDays: number; swapPairs: Record<string, string> };
export type TLHResult = { weights: TargetWeights; swaps: Array<{ from: AssetId; to: AssetId; expectedLoss: number }> };

export function applyTaxLossHarvesting(
  weights: TargetWeights,
  portfolio: Portfolio,
  prices: PriceMap,
  asOf: Date,
  config: TLHConfig,
  recentBuyHistory: ReadonlyArray<{ assetId: AssetId; t: Date }> = [],
): TLHResult {
  if (!config.enabled) return { weights, swaps: [] };
  const lossByAsset = new Map<AssetId, number>();
  for (const lot of portfolio.lots ?? []) {
    const price = prices.get(lot.asset.id);
    if (price === undefined) continue;
    const loss = lot.basis - lot.quantity * price;
    if (loss > 0) lossByAsset.set(lot.asset.id, (lossByAsset.get(lot.asset.id) ?? 0) + loss);
  }
  const out = new Map(weights);
  const swaps: TLHResult['swaps'] = [];
  const cut = asOf.getTime() - config.cooldownDays * MS_PER_DAY;
  for (const [assetId, loss] of lossByAsset) {
    if (loss < config.minLossThreshold) continue;
    const swapTo = config.swapPairs[assetId];
    if (!swapTo) continue;
    if (recentBuyHistory.some((b) => b.assetId === assetId && b.t.getTime() >= cut)) continue;
    const w = out.get(assetId) ?? 0;
    if (w <= 0) continue;
    out.set(swapTo as AssetId, (out.get(swapTo as AssetId) ?? 0) + w);
    out.delete(assetId);
    swaps.push({ from: assetId, to: swapTo as AssetId, expectedLoss: loss });
  }
  return { weights: out, swaps };
}
```

- [ ] **Step 3: Re-export + commit.**

```bash
npm test apply-tax-loss-harvest
git add src/tactical/apply-tax-loss-harvest.ts src/tactical/apply-tax-loss-harvest.test.ts src/tactical/index.ts
git commit -m "feat(sdk/tactical): applyTaxLossHarvesting"
```

---

### Task 24: Wire pre-passes into `fromSpec` (taxes + TLH) with `recentBuys` state

**Goal:** Run `applyTaxPolicy` then `applyTaxLossHarvesting` between `evaluateRuleTree` and `reconcile`. Broaden the threaded state to carry a `recentBuys` ring buffer for TLH cooldown.

**Files:**
- Modify: `src/tactical/from-spec.ts`, `src/tactical/from-spec.test.ts`
- Modify: `src/tactical/types.ts` (new `TacticalRuntimeState`), `src/tactical/index.ts`, `src/index.ts`

**Acceptance Criteria:**
- [ ] `FromSpecOptions` grows `taxes?: TaxPolicyConfig` and `taxLossHarvesting?: TLHConfig`.
- [ ] `fromSpec` now returns `Strategy<TacticalFeatures, TacticalRuntimeState>` where `TacticalRuntimeState = { ruleTree: RuleTreeState; recentBuys: { assetId: AssetId; t: Date }[] }`. `initialState()` = `{ ruleTree: new Map(), recentBuys: [] }`. **(Documented type change for 0.5.0 — runtime-compatible; `runLive` seeds `finalState` from `history`.)**
- [ ] In `build`: `const weights1 = applyTaxPolicy(evaluated.weights, portfolio, features.prices, t, opts.taxes); const tlh = opts.taxLossHarvesting?.enabled ? applyTaxLossHarvesting(weights1, portfolio, features.prices, t, opts.taxLossHarvesting, state.recentBuys) : { weights: weights1, swaps: [] }; const orders = reconcile(tlh.weights, portfolio, features.prices, assetsById);`
- [ ] After reconcile, append `{ assetId, t }` for each buy order (`delta > 0`) to `recentBuys`, pruning entries older than `30 + (taxLossHarvesting?.cooldownDays ?? 0)` days.
- [ ] The early-return paths (non-rebalance day, missing prices, rule-tree error) return `{ orders: [], state }` with the broadened state preserved.
- [ ] Tests: (a) `taxes.driftBand: 0.05` with within-band portfolio → 0 orders vs orders without; (b) TLH swap SPY→IVV when SPY held at a loss above threshold → reconcile sells SPY, buys IVV.

**Verify:** `npm test from-spec && npm test parity`

**Steps:**

- [ ] **Step 1: Add `TacticalRuntimeState`** to `tactical/types.ts`:

```ts
import type { AssetId } from '../interfaces/types';
/** Internal threaded state for fromSpec strategies: rule-tree hysteresis + TLH cooldown buffer. */
export type TacticalRuntimeState = {
  ruleTree: RuleTreeState;
  recentBuys: { assetId: AssetId; t: Date }[];
};
```

- [ ] **Step 2: Update `FromSpecOptions`** (`from-spec.ts`) — add `taxes?` / `taxLossHarvesting?` (import `TaxPolicyConfig`, `TLHConfig`, `applyTaxPolicy`, `applyTaxLossHarvesting`).

- [ ] **Step 3: Change the return type + state.** `fromSpec(...): Strategy<TacticalFeatures, TacticalRuntimeState>`; `initialState: () => ({ ruleTree: new Map() as RuleTreeState, recentBuys: [] })`. Update `build` to read `state.ruleTree` for `evaluateRuleTree(spec.rules, defined, state.ruleTree)` and return `{ orders, state: { ruleTree: evaluated.state, recentBuys: prunedRecentBuys } }`. Early returns: `return { orders: [], state }`.

  Buy-history update after reconcile:

```ts
      const orders = reconcile(tlh.weights, portfolio, features.prices, assetsById);
      const cooldownWindow = 30 + (opts.taxLossHarvesting?.cooldownDays ?? 0);
      const cut = t.getTime() - cooldownWindow * 86_400_000;
      const recentBuys = [
        ...state.recentBuys.filter((b) => b.t.getTime() >= cut),
        ...orders.filter((o) => o.kind === 'rebalance' && o.delta > 0).map((o) => ({ assetId: o.asset.id, t })),
      ];
      return { orders, state: { ruleTree: evaluated.state, recentBuys } };
```

- [ ] **Step 4: Update `from-spec.test.ts`** — existing tests that read `state` as a `Map` must change to `state.ruleTree`. Add the two new acceptance tests.

- [ ] **Step 5: Export** `TacticalRuntimeState`, `TaxPolicyConfig`, `TLHConfig`, `applyTaxPolicy`, `applyTaxLossHarvesting`, `currentWeights`, `withinDriftBand` from `tactical/index.ts` + `src/index.ts`.

- [ ] **Step 6: Commit.**

```bash
npm test from-spec && npm test parity && npm run build
git add src/tactical/ src/index.ts
git commit -m "feat(sdk/tactical): fromSpec runs applyTaxPolicy + TLH before reconcile"
```

---

### Task 25: Year-end wash-sale sweep in `runBacktest` (`tax/wash-sale.ts` + hook)

**Goal:** Add the pure wash-sale utilities and an idempotent year-boundary (and end-of-run) sweep in `runBacktest` that marks disallowed losses and bumps replacement-lot basis.

**Files:**
- Create: `src/tax/wash-sale.ts`, `src/tax/wash-sale.test.ts`
- Modify: `src/tax/index.ts`, `src/index.ts`
- Modify: `src/strategy/run-backtest.ts`, `src/strategy/run-backtest.test.ts`

**Acceptance Criteria:**
- [ ] `findWashSales(realized, lots, { windowDays = 30 })` → `WashSaleAdjustment[]`: for each `capital-gain` event with `gain < 0`, find a same-asset lot (≠ the loss lot) opened within ±`windowDays` of `closeDate`; at most one adjustment per loss event.
- [ ] `applyWashSaleAdjustment(lots, adj)` bumps the replacement lot's `basis` and `washSaleAdjustment` by `disallowedAmount`.
- [ ] runBacktest sweep at each calendar-year transition + at end: over the closing year's unmarked losses, mark matching `RealizedEvent.washSaleDisallowed` and apply basis bumps. **Idempotent** — already-marked events are skipped.
- [ ] Tests: pure-util simple wash + 31-day gap (no wash); integration: buy → sell at loss → rebuy within 30d → year end → loss event marked + replacement basis bumped; running the sweep twice is a no-op.

**Verify:** `npm test wash-sale && npm test run-backtest`

**Steps:**

- [ ] **Step 1: `src/tax/wash-sale.ts`** (issue Task 41 code):

```ts
import type { Lot, RealizedEvent } from '../portfolio/types';

const MS_PER_DAY = 86_400_000;

export type WashSaleAdjustment = { lossEventLotId: string; disallowedAmount: number; replacementLotId: string };

export function findWashSales(
  realized: readonly RealizedEvent[],
  lots: readonly Lot[],
  options: { windowDays?: number } = {},
): WashSaleAdjustment[] {
  const window = options.windowDays ?? 30;
  const out: WashSaleAdjustment[] = [];
  for (const ev of realized) {
    if (ev.gain >= 0 || ev.incomeKind !== 'capital-gain' || ev.washSaleDisallowed !== undefined) continue;
    const winStart = ev.closeDate.getTime() - window * MS_PER_DAY;
    const winEnd = ev.closeDate.getTime() + window * MS_PER_DAY;
    const replacement = lots.find((l) =>
      l.asset.id === ev.asset.id && l.id !== ev.lotId &&
      l.openDate.getTime() >= winStart && l.openDate.getTime() <= winEnd);
    if (replacement) out.push({ lossEventLotId: ev.lotId, disallowedAmount: -ev.gain, replacementLotId: replacement.id });
  }
  return out;
}

export function applyWashSaleAdjustment(lots: readonly Lot[], adj: WashSaleAdjustment): Lot[] {
  return lots.map((l) => l.id === adj.replacementLotId
    ? { ...l, basis: l.basis + adj.disallowedAmount, washSaleAdjustment: (l.washSaleAdjustment ?? 0) + adj.disallowedAmount }
    : l);
}
```

- [ ] **Step 2: Pure-util tests.**

- [ ] **Step 3: runBacktest sweep.** Add a closure inside `runBacktest` after `portfolio`/`snapshots` are declared:

```ts
  const runWashSaleSweep = (year: number): void => {
    const losses = (portfolio.realized ?? []).filter(
      (e) => e.closeDate.getUTCFullYear() === year && e.incomeKind === 'capital-gain' && e.gain < 0 && e.washSaleDisallowed === undefined,
    );
    const adjustments = findWashSales(losses, portfolio.lots ?? []);
    if (adjustments.length === 0) return;
    let lots = [...(portfolio.lots ?? [])];
    const byLossLot = new Map(adjustments.map((a) => [a.lossEventLotId, a]));
    const realized = (portfolio.realized ?? []).map((e) => {
      const a = byLossLot.get(e.lotId);
      return a && e.washSaleDisallowed === undefined && e.gain < 0 ? { ...e, washSaleDisallowed: a.disallowedAmount } : e;
    });
    for (const a of adjustments) lots = applyWashSaleAdjustment(lots, a);
    portfolio = { ...portfolio, lots, realized };
  };
```

  Track `prevYear` across the session loop; when `t.getUTCFullYear() !== prevYear` (and `prevYear >= 0`) call `runWashSaleSweep(prevYear)`; set `prevYear = t.getUTCFullYear()`. After the loop, call `runWashSaleSweep(prevYear)`.

  > Note on snapshot history: the sweep mutates the carried `portfolio`; prior snapshots hold earlier portfolio references. The sweep's effect is visible on `finalPortfolio` and subsequent snapshots — document that wash-sale marking is finalized at year/run boundaries, not retroactively rewritten into past snapshots.

- [ ] **Step 4: Integration + idempotency tests.**

- [ ] **Step 5: Re-export + commit.**

```bash
npm test wash-sale && npm test run-backtest && npm test parity
git add src/tax/wash-sale.ts src/tax/wash-sale.test.ts src/tax/index.ts src/index.ts src/strategy/run-backtest.ts src/strategy/run-backtest.test.ts
git commit -m "feat(sdk): wash-sale utilities + idempotent year-end sweep in runBacktest"
```

> **PR6 done.** Final checkpoint: `npm test && npm run build && npm run lint && npm run docs:check`. Bump `package.json` to `0.5.0` in the release PR.

---

## Final acceptance (issue checklist)

- [ ] All public APIs added with TSDoc (Tasks 1,2,3,5–25).
- [ ] Unit tests for every new `tax/` and `tactical/` module, ≥90% line coverage on new code (`npx vitest run --coverage src/tax src/tactical`).
- [ ] Integration test in `run-backtest.test.ts`: monthly deposit + `dividends.reinvest: true` + `cashYield {flat, 0.05}` + `taxes.driftBand 0.05` → sensible snapshots (cash credits, DRIP lots, interest, fewer rebalances) (Task 20/24).
- [ ] `Portfolio.positions` still satisfies `reconcile` (unchanged; `positionsByAsset` offered) — **parity green** (every PR).
- [ ] `BacktestSnapshot.cashFlow / dividendIncome / interestIncome` populated when events occur (Tasks 10,19,20).
- [ ] No breaking changes to `RunBacktestOptions` / `RunLiveOptions` / `FromSpecOptions` callers — all new fields optional. (The `fromSpec` return-type `S` widening in Task 24 is the one documented type change; runtime-compatible.)
- [ ] Released as `@livefolio/sdk@0.5.0`.

## Out of scope (per issue)

Federal bracket tables, state/NIIT/AMT/FTC/§199A, cross-year carry-forward *consumption*, qualified-dividend-preservation heuristics, ETF substantially-identical equivalence (caller supplies swap pairs), live-mode dividends/TLH (live mode gets cash-event scheduling only), and the `livefolio/yfinance#4` adapter changes (SDK ships the interface + routing proxy only).
