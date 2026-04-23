# Incremental Strategy Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both post-close sync and live preview of strategies O(1-ish) in the incremental case by persisting running state on `indicators_series.metadata` (checkpoint row) and rewriting signal/strategy sync to consume existing last-row accessors.

**Architecture:** Each stateful indicator type grows a `computeNext` step function + a `computeInitialState` helper. The indicator handle stores state on the single most recent `indicators_series` row and clears metadata from older rows. Fast paths in indicator `_sync` / `computeAt`, signal `_sync`, and strategy `_evaluate` consume these checkpoints; cold paths remain as bootstrap / fallback. No schema migrations.

**Tech Stack:** TypeScript (strict mode), Vitest, tsup, Supabase JS client (storage package).

**Spec:** `docs/specs/2026-04-21-incremental-evaluation-design.md`

**Cross-package note:** Three packages are touched:
1. `@livefolio/sdk` — interface, handles, computations (this repo's `src/`)
2. `@livefolio/storage` — Supabase impl at `/Users/raksi/Documents/Personal/livefolio-2/storage/src/indicators.ts`
3. Tests inside `@livefolio/sdk` that hand-roll `StorageProvider` mocks — new methods must be added to each mock

---

## Phase 1 — Computation `*Next` + initial-state helpers

Each stateful computation file gets two exports: a step function and an initial-state helper.

### Task 1.1: SMA — type, step, and initial-state helper

**Files:**
- Modify: `src/computations/sma.ts`
- Test: `src/computations/sma-next.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/computations/sma-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSma } from './sma';
import { smaNext, smaInitialState } from './sma';
import type { DailyBar } from '../handles/indicator';

function synthetic(n: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    bars.push({
      date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + (x % 10000) / 100,
    });
  }
  return bars;
}

describe('smaNext / smaInitialState', () => {
  it('initialState returns null when bars.length < lookback', () => {
    expect(smaInitialState([], 5)).toBeNull();
    expect(smaInitialState(synthetic(4), 5)).toBeNull();
  });

  it('initialState carries the last N raw values as tail', () => {
    const bars = synthetic(10);
    const state = smaInitialState(bars, 5);
    expect(state).toEqual({ tail: bars.slice(-5).map((b) => b.value) });
  });

  it('replaying smaNext from a checkpoint matches computeSma', () => {
    const bars = synthetic(40, 7);
    const lookback = 10;
    const full = computeSma(bars, lookback);
    // Checkpoint at index lookback - 1 of full (first emitted point) — corresponds
    // to raw bars[0..lookback-1]. State tail is the raw bars[0..lookback-1].values.
    let state = smaInitialState(bars.slice(0, lookback), lookback)!;
    const replay: number[] = [full[0]!.value];
    for (let i = lookback; i < bars.length; i++) {
      const { value, state: next } = smaNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/sma-next.test.ts`
Expected: FAIL — `smaNext`/`smaInitialState` undefined imports.

- [ ] **Step 3: Implement `smaNext` and `smaInitialState`**

Modify `src/computations/sma.ts` — append below `computeSma`:

```ts
export interface SmaState {
  tail: number[];
}

export function smaInitialState(bars: DailyBar[], lookback: number): SmaState | null {
  if (bars.length < lookback) return null;
  return { tail: bars.slice(-lookback).map((b) => b.value) };
}

export function smaNext(
  prev: SmaState,
  newRaw: number,
  lookback: number,
): { value: number; state: SmaState } {
  const tail = [...prev.tail.slice(1), newRaw];
  const sum = tail.reduce((a, b) => a + b, 0);
  return { value: sum / lookback, state: { tail } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/computations/sma-next.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/computations/sma.ts src/computations/sma-next.test.ts
git commit -m "feat(computations): add smaNext + smaInitialState"
```

---

### Task 1.2: Return — type, step, and initial-state helper

**Files:**
- Modify: `src/computations/returns.ts`
- Test: `src/computations/returns-next.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/computations/returns-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeReturns } from './returns';
import { returnNext, returnInitialState } from './returns';
import type { DailyBar } from '../handles/indicator';

function synthetic(n: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    bars.push({
      date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + (x % 10000) / 100,
    });
  }
  return bars;
}

describe('returnNext / returnInitialState', () => {
  it('initialState returns null when bars.length < lookback + 1', () => {
    expect(returnInitialState([], 5)).toBeNull();
    expect(returnInitialState(synthetic(5), 5)).toBeNull();
  });

  it('initialState carries the last N+1 raw values as tail', () => {
    const bars = synthetic(10);
    const state = returnInitialState(bars, 5);
    expect(state).toEqual({ tail: bars.slice(-6).map((b) => b.value) });
  });

  for (const mode of ['pct', 'abs'] as const) {
    it(`replaying returnNext from a checkpoint matches computeReturns (${mode})`, () => {
      const bars = synthetic(30, 11);
      const lookback = 5;
      const full = computeReturns(bars, lookback, mode);
      let state = returnInitialState(bars.slice(0, lookback + 1), lookback)!;
      const replay: number[] = [full[0]!.value];
      for (let i = lookback + 1; i < bars.length; i++) {
        const { value, state: next } = returnNext(state, bars[i]!.value, lookback, mode);
        replay.push(value);
        state = next;
      }
      expect(replay.length).toBe(full.length);
      for (let i = 0; i < full.length; i++) {
        expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
      }
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/returns-next.test.ts`
Expected: FAIL — `returnNext`/`returnInitialState` undefined imports.

- [ ] **Step 3: Implement `returnNext` and `returnInitialState`**

Modify `src/computations/returns.ts` — append below `computeReturns`:

```ts
export interface ReturnState {
  tail: number[];
}

export function returnInitialState(bars: DailyBar[], lookback: number): ReturnState | null {
  if (bars.length < lookback + 1) return null;
  return { tail: bars.slice(-(lookback + 1)).map((b) => b.value) };
}

export function returnNext(
  prev: ReturnState,
  newRaw: number,
  lookback: number,
  mode: ReturnMode = 'pct',
): { value: number; state: ReturnState } {
  const tail = [...prev.tail.slice(1), newRaw];
  const old = tail[0]!;
  const value = mode === 'abs' ? newRaw - old : (newRaw - old) / old;
  return { value, state: { tail } };
}
```

Also add the `DailyBar` import if it is not already there:

```ts
import type { DailyBar } from '../handles/indicator';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/computations/returns-next.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/computations/returns.ts src/computations/returns-next.test.ts
git commit -m "feat(computations): add returnNext + returnInitialState"
```

---

### Task 1.3: Volatility — type, step, and initial-state helper

**Files:**
- Modify: `src/computations/volatility.ts`
- Test: `src/computations/volatility-next.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/computations/volatility-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeVolatility, volatilityNext, volatilityInitialState } from './volatility';
import type { DailyBar } from '../handles/indicator';

function synthetic(n: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    bars.push({
      date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + (x % 10000) / 100,
    });
  }
  return bars;
}

describe('volatilityNext / volatilityInitialState', () => {
  it('initialState returns null when bars.length < lookback + 1', () => {
    expect(volatilityInitialState(synthetic(5), 5)).toBeNull();
  });

  it('initialState carries the last N+1 raw values as tail', () => {
    const bars = synthetic(10);
    const state = volatilityInitialState(bars, 5);
    expect(state).toEqual({ tail: bars.slice(-6).map((b) => b.value) });
  });

  it('replaying volatilityNext from a checkpoint matches computeVolatility', () => {
    const bars = synthetic(30, 13);
    const lookback = 5;
    const full = computeVolatility(bars, lookback);
    let state = volatilityInitialState(bars.slice(0, lookback + 1), lookback)!;
    const replay: number[] = [full[0]!.value];
    for (let i = lookback + 1; i < bars.length; i++) {
      const { value, state: next } = volatilityNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/volatility-next.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Modify `src/computations/volatility.ts` — append below `computeVolatility`:

```ts
export interface VolatilityState {
  tail: number[];
}

export function volatilityInitialState(bars: DailyBar[], lookback: number): VolatilityState | null {
  if (bars.length < lookback + 1) return null;
  return { tail: bars.slice(-(lookback + 1)).map((b) => b.value) };
}

export function volatilityNext(
  prev: VolatilityState,
  newRaw: number,
  lookback: number,
): { value: number; state: VolatilityState } {
  const tail = [...prev.tail.slice(1), newRaw];
  const returns: number[] = [];
  for (let i = 1; i < tail.length; i++) returns.push(tail[i]! / tail[i - 1]! - 1);
  const mean = returns.reduce((s, r) => s + r, 0) / lookback;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / lookback;
  return { value: Math.sqrt(variance), state: { tail } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/computations/volatility-next.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/computations/volatility.ts src/computations/volatility-next.test.ts
git commit -m "feat(computations): add volatilityNext + volatilityInitialState"
```

---

### Task 1.4: Drawdown — type, step, and initial-state helper

**Files:**
- Modify: `src/computations/drawdown.ts`
- Test: `src/computations/drawdown-next.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/computations/drawdown-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDrawdown, drawdownNext, drawdownInitialState } from './drawdown';
import type { DailyBar } from '../handles/indicator';

function synthetic(n: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    bars.push({
      date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + (x % 10000) / 100,
    });
  }
  return bars;
}

describe('drawdownNext / drawdownInitialState', () => {
  it('initialState returns null when bars.length < lookback', () => {
    expect(drawdownInitialState(synthetic(4), 5)).toBeNull();
  });

  it('initialState carries the last N raw values as tail', () => {
    const bars = synthetic(10);
    expect(drawdownInitialState(bars, 5)).toEqual({ tail: bars.slice(-5).map((b) => b.value) });
  });

  it('replaying drawdownNext from a checkpoint matches computeDrawdown', () => {
    const bars = synthetic(30, 17);
    const lookback = 5;
    const full = computeDrawdown(bars, lookback);
    let state = drawdownInitialState(bars.slice(0, lookback), lookback)!;
    const replay: number[] = [full[0]!.value];
    for (let i = lookback; i < bars.length; i++) {
      const { value, state: next } = drawdownNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/drawdown-next.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Modify `src/computations/drawdown.ts` — append:

```ts
export interface DrawdownState {
  tail: number[];
}

export function drawdownInitialState(bars: DailyBar[], lookback: number): DrawdownState | null {
  if (bars.length < lookback) return null;
  return { tail: bars.slice(-lookback).map((b) => b.value) };
}

export function drawdownNext(
  prev: DrawdownState,
  newRaw: number,
  lookback: number,
): { value: number; state: DrawdownState } {
  const tail = [...prev.tail.slice(1), newRaw];
  let max = -Infinity;
  for (const v of tail) if (v > max) max = v;
  return { value: (newRaw - max) / max, state: { tail } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/computations/drawdown-next.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/computations/drawdown.ts src/computations/drawdown-next.test.ts
git commit -m "feat(computations): add drawdownNext + drawdownInitialState"
```

---

### Task 1.5: EMA — type, step, and initial-state helper

**Files:**
- Modify: `src/computations/ema.ts`
- Test: `src/computations/ema-next.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/computations/ema-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeEma, emaNext, emaInitialState } from './ema';
import type { DailyBar } from '../handles/indicator';

function synthetic(n: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    bars.push({
      date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + (x % 10000) / 100,
    });
  }
  return bars;
}

describe('emaNext / emaInitialState', () => {
  it('initialState returns null when bars.length < lookback', () => {
    expect(emaInitialState(synthetic(4), 5)).toBeNull();
  });

  it('initialState equals the last emitted ema value', () => {
    const bars = synthetic(12, 3);
    const full = computeEma(bars, 5);
    expect(emaInitialState(bars, 5)).toEqual({ ema: full[full.length - 1]!.value });
  });

  it('replaying emaNext from the seed checkpoint matches computeEma', () => {
    const bars = synthetic(40, 19);
    const lookback = 10;
    const full = computeEma(bars, lookback);
    // Seed at index lookback-1 of full (the first output). Its bar corresponds to
    // bars[lookback-1]. Start from the simple average of the first N bars.
    const seedSum = bars.slice(0, lookback).reduce((s, b) => s + b.value, 0);
    let state = { ema: seedSum / lookback };
    const replay: number[] = [state.ema];
    for (let i = lookback; i < bars.length; i++) {
      const { value, state: next } = emaNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/ema-next.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Modify `src/computations/ema.ts` — append:

```ts
export interface EmaState {
  ema: number;
}

export function emaInitialState(bars: DailyBar[], lookback: number): EmaState | null {
  if (bars.length < lookback) return null;
  const series = computeEma(bars, lookback);
  if (series.length === 0) return null;
  return { ema: series[series.length - 1]!.value };
}

export function emaNext(
  prev: EmaState,
  newRaw: number,
  lookback: number,
): { value: number; state: EmaState } {
  const multiplier = 2 / (lookback + 1);
  const ema = newRaw * multiplier + prev.ema * (1 - multiplier);
  return { value: ema, state: { ema } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/computations/ema-next.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/computations/ema.ts src/computations/ema-next.test.ts
git commit -m "feat(computations): add emaNext + emaInitialState"
```

---

### Task 1.6: RSI — type, step, and initial-state helper

**Files:**
- Modify: `src/computations/rsi.ts`
- Test: `src/computations/rsi-next.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/computations/rsi-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeRsi, rsiNext, rsiInitialState } from './rsi';
import type { DailyBar } from '../handles/indicator';

function synthetic(n: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    bars.push({
      date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + (x % 10000) / 100,
    });
  }
  return bars;
}

describe('rsiNext / rsiInitialState', () => {
  it('initialState returns null when bars.length < lookback + 1', () => {
    expect(rsiInitialState(synthetic(5), 5)).toBeNull();
  });

  it('replaying rsiNext from the seed checkpoint matches computeRsi', () => {
    const bars = synthetic(40, 23);
    const lookback = 10;
    const full = computeRsi(bars, lookback);
    // Build the same seed as computeRsi uses at index lookback:
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= lookback; i++) {
      const change = bars[i]!.value - bars[i - 1]!.value;
      if (change > 0) avgGain += change;
      else avgLoss += -change;
    }
    avgGain /= lookback;
    avgLoss /= lookback;
    let state = { avgGain, avgLoss, prev: bars[lookback]!.value };

    const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const replay: number[] = [avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0)];
    for (let i = lookback + 1; i < bars.length; i++) {
      const { value, state: next } = rsiNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });

  it('initialState returns the terminal state of computeRsi', () => {
    const bars = synthetic(30, 29);
    const lookback = 5;
    const state = rsiInitialState(bars, lookback)!;
    // One more bar → rsiNext should produce the RSI that computeRsi would if we had that bar
    const extra = { date: '2030-01-01', value: bars[bars.length - 1]!.value * 1.01 };
    const fullExtended = computeRsi([...bars, extra], lookback);
    const { value } = rsiNext(state, extra.value, lookback);
    expect(value).toBeCloseTo(fullExtended[fullExtended.length - 1]!.value, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/rsi-next.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Modify `src/computations/rsi.ts` — append:

```ts
export interface RsiState {
  avgGain: number;
  avgLoss: number;
  prev: number;
}

export function rsiInitialState(bars: DailyBar[], lookback: number): RsiState | null {
  if (bars.length < lookback + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= lookback; i++) {
    const change = bars[i]!.value - bars[i - 1]!.value;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= lookback;
  avgLoss /= lookback;
  let state: RsiState = { avgGain, avgLoss, prev: bars[lookback]!.value };
  for (let i = lookback + 1; i < bars.length; i++) {
    const { state: next } = rsiNext(state, bars[i]!.value, lookback);
    state = next;
  }
  return state;
}

export function rsiNext(
  prev: RsiState,
  newRaw: number,
  lookback: number,
): { value: number; state: RsiState } {
  const change = newRaw - prev.prev;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;
  const avgGain = (prev.avgGain * (lookback - 1) + gain) / lookback;
  const avgLoss = (prev.avgLoss * (lookback - 1) + loss) / lookback;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  return { value, state: { avgGain, avgLoss, prev: newRaw } };
}
```

Add `import type { DailyBar } from '../handles/indicator';` at the top if missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/computations/rsi-next.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/computations/rsi.ts src/computations/rsi-next.test.ts
git commit -m "feat(computations): add rsiNext + rsiInitialState"
```

---

### Task 1.7: Type-dispatch helper in `computations/index.ts`

**Files:**
- Modify: `src/computations/index.ts`
- Test: `src/computations/next-index.test.ts` (new)

- [ ] **Step 1: Read existing `computations/index.ts` to see what's exported**

Run: `cat src/computations/index.ts`

- [ ] **Step 2: Write the failing test**

Create `src/computations/next-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getNextComputation, getInitialStateFn } from './index';

describe('next computation dispatch', () => {
  it('returns step + seed for every stateful type', () => {
    for (const type of ['SMA', 'EMA', 'RSI', 'Return', 'Volatility', 'Drawdown']) {
      expect(getNextComputation(type)).toBeDefined();
      expect(getInitialStateFn(type)).toBeDefined();
    }
  });

  it('returns undefined for stateless types', () => {
    for (const type of ['Price', 'VIX', 'VIX3M', 'T3M', 'Month', 'Threshold']) {
      expect(getNextComputation(type)).toBeUndefined();
      expect(getInitialStateFn(type)).toBeUndefined();
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/computations/next-index.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the dispatchers**

Modify `src/computations/index.ts` — append below the existing `getComputation` export:

```ts
import { smaNext, smaInitialState } from './sma';
import { emaNext, emaInitialState } from './ema';
import { rsiNext, rsiInitialState } from './rsi';
import { returnNext, returnInitialState } from './returns';
import { volatilityNext, volatilityInitialState } from './volatility';
import { drawdownNext, drawdownInitialState } from './drawdown';
import type { DailyBar } from '../handles/indicator';

export type NextStepFn = (
  prev: unknown,
  newRaw: number,
  lookback: number,
) => { value: number; state: unknown };

export type InitialStateFn = (bars: DailyBar[], lookback: number) => unknown | null;

const NEXT: Record<string, NextStepFn> = {
  SMA: smaNext as NextStepFn,
  EMA: emaNext as NextStepFn,
  RSI: rsiNext as NextStepFn,
  Return: ((prev, newRaw, lookback) => returnNext(prev as { tail: number[] }, newRaw, lookback, 'pct')) as NextStepFn,
  Volatility: volatilityNext as NextStepFn,
  Drawdown: drawdownNext as NextStepFn,
};

const SEED: Record<string, InitialStateFn> = {
  SMA: smaInitialState as InitialStateFn,
  EMA: emaInitialState as InitialStateFn,
  RSI: rsiInitialState as InitialStateFn,
  Return: returnInitialState as InitialStateFn,
  Volatility: volatilityInitialState as InitialStateFn,
  Drawdown: drawdownInitialState as InitialStateFn,
};

export function getNextComputation(type: string): NextStepFn | undefined {
  return NEXT[type];
}

export function getInitialStateFn(type: string): InitialStateFn | undefined {
  return SEED[type];
}
```

Note: `Return` has a special wrapper because its `mode` parameter is resolved by the indicator handle based on `getProviderInfo(type, symbol).rateSeries`. For now the dispatcher defaults to `'pct'` — the indicator handle will override by calling `returnNext` directly when it needs `'abs'`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/computations/next-index.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/computations/index.ts src/computations/next-index.test.ts
git commit -m "feat(computations): dispatch table for *Next / *InitialState"
```

---

## Phase 2 — Storage interface + test mock updates

### Task 2.1: Extend `StorageProvider.indicators` with metadata support

**Files:**
- Modify: `src/providers/storage.ts`

- [ ] **Step 1: Read the file**

Read `src/providers/storage.ts` (already seen; confirm current shape).

- [ ] **Step 2: Update the interface**

Replace the `indicators` block in `src/providers/storage.ts`:

```ts
  indicators: {
    upsert(identity: {
      type: string;
      tickerId: number | null;
      lookback: number;
      delay: number;
      unit: string | null;
      threshold: number | null;
    }): Promise<{ id: number }>;
    findOrCreate(identity: {
      type: string;
      tickerId: number | null;
      lookback: number;
      delay: number;
      unit: string | null;
      threshold: number | null;
    }): Promise<{ id: number }>;
    getSeries(indicatorId: number, range?: DateRange): Promise<DailyBar[]>;
    writeSeries(
      indicatorId: number,
      bars: DailyBar[],
      opts?: { metadata?: unknown },
    ): Promise<void>;
    getLatestSeriesDate(indicatorId: number): Promise<string | null>;
    getValue(indicatorId: number, date?: string): Promise<number | null>;
    getLatestBar(indicatorId: number): Promise<
      { date: string; value: number; metadata: unknown } | null
    >;
  };
```

- [ ] **Step 3: Run typecheck to surface every caller that needs updating**

Run: `npx tsc --noEmit`
Expected: errors in test files that construct mocks but now miss `getLatestBar`. (Implementations that don't declare the new field are fine because it's an additional field; adding it in test mocks is the main work.)

- [ ] **Step 4: Commit**

```bash
git add src/providers/storage.ts
git commit -m "feat(storage): add getLatestBar + optional metadata on writeSeries"
```

---

### Task 2.2: Add `getLatestBar` to all SDK-side mocks

**Files to update** (every file that builds a `StorageProvider.indicators` mock):
- `src/handles/indicator.test.ts`
- `src/handles/signal.test.ts`
- `src/handles/strategy.test.ts`
- `src/handles/sync.test.ts`
- `src/handles/strategy-simulate.test.ts`
- `src/handles/fromRow.test.ts`
- `src/handles/portfolio.test.ts`
- `src/backtest/push.test.ts`
- `src/backtest/simulate.test.ts`
- `src/backtest/push-and-preview.test.ts`
- `src/client.test.ts`

- [ ] **Step 1: Find all hand-rolled mocks**

Run: `grep -rn "getLatestSeriesDate:" src/`
The lines returned are the mocks that need an adjacent `getLatestBar` entry.

- [ ] **Step 2: Add `getLatestBar: vi.fn().mockResolvedValue(null)` next to every `getLatestSeriesDate:` line in mocks**

Concrete edit pattern for each occurrence — replace:

```ts
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getValue: vi.fn().mockResolvedValue(null),
```

with:

```ts
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getValue: vi.fn().mockResolvedValue(null),
      getLatestBar: vi.fn().mockResolvedValue(null),
```

Apply to every file listed above. When `getValue:` is absent from a mock, add `getLatestBar: vi.fn().mockResolvedValue(null)` immediately after `getLatestSeriesDate:`.

- [ ] **Step 3: Run tests to ensure they all still pass**

Run: `npm test`
Expected: all pass — the mocks now satisfy the interface.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "test: extend StorageProvider mocks with getLatestBar"
```

---

### Task 2.3: Update `/storage` Supabase impl

**Files:**
- Modify: `/Users/raksi/Documents/Personal/livefolio-2/storage/src/indicators.ts`
- Modify: `/Users/raksi/Documents/Personal/livefolio-2/storage/src/indicators.test.ts`

This task happens in the storage package. The SDK depends on it via workspace linkage; ensure `npm -w sdk test` still passes after.

- [ ] **Step 1: Extend `writeSeries` to accept `opts.metadata`**

Replace the `writeSeries` body in `storage/src/indicators.ts` with:

```ts
async writeSeries(indicatorId, bars: DailyBar[], opts?: { metadata?: unknown }) {
  if (bars.length === 0) return;
  const dayIds = await resolveTradingDayIds(
    supabase,
    bars.map((b) => b.date),
  );
  const rows = bars
    .filter((b) => dayIds.has(b.date))
    .map((b) => ({
      indicator_id: indicatorId,
      trading_day_id: dayIds.get(b.date)!,
      value: b.value,
    }));
  const { data: { session } } = await supabase.auth.getSession();
  await batchedUpsert(
    supabase.from('indicators_series'),
    rows,
    'indicator_id,trading_day_id',
    'indicators.writeSeries',
    session !== null,
  );
  if (opts?.metadata !== undefined) {
    // Park metadata on the new max-date row; clear it anywhere older.
    const newMaxDate = bars.reduce((acc, b) => (b.date > acc ? b.date : acc), bars[0]!.date);
    const newMaxDayId = dayIds.get(newMaxDate);
    if (newMaxDayId !== undefined) {
      const { error: setErr } = await supabase
        .from('indicators_series')
        .update({ metadata: opts.metadata as never })
        .eq('indicator_id', indicatorId)
        .eq('trading_day_id', newMaxDayId);
      if (setErr) throw new Error(`indicators.writeSeries.setMetadata: ${setErr.message}`);
      const { error: clrErr } = await supabase
        .from('indicators_series')
        .update({ metadata: null as never })
        .eq('indicator_id', indicatorId)
        .lt('trading_day_id', newMaxDayId)
        .not('metadata', 'is', null);
      if (clrErr) throw new Error(`indicators.writeSeries.clearMetadata: ${clrErr.message}`);
    }
  }
},
```

- [ ] **Step 2: Add `getLatestBar` impl**

Append inside the `createIndicators` return:

```ts
async getLatestBar(indicatorId) {
  const { data } = await supabase
    .from('indicators_series')
    .select('value, metadata, trading_days(date)')
    .eq('indicator_id', indicatorId)
    .order('trading_day_id', { ascending: false })
    .limit(1)
    .single();
  if (!data) return null;
  const td = data.trading_days as unknown as { date: string } | null;
  if (!td) return null;
  return { date: td.date, value: data.value, metadata: (data as { metadata: unknown }).metadata };
},
```

- [ ] **Step 3: Add/update tests in `storage/src/indicators.test.ts`**

Add a unit test confirming `writeSeries` with `opts.metadata` issues the parking + clearing update calls, and `getLatestBar` reads a row. Follow the existing pattern (mocking `supabase` chain). Keep scope tight: one happy-path test each.

```ts
it('writeSeries parks metadata on the max-date row and clears older metadata', async () => {
  // Arrange: a test double for the supabase client where update chains return { error: null }
  // and `.select('value, metadata, trading_days(date)').eq(...).order(...).limit(1).single()` returns
  // a stubbed row.  Follow the existing patterns in this file.
  // Assert: the update parking the metadata is called exactly once; the clearing update is called
  // exactly once with .lt('trading_day_id', ...).
});

it('getLatestBar returns { date, value, metadata }', async () => {
  // Arrange supabase double to return a single row including metadata.
  // Assert the shape of the returned object.
});
```

Implement following the existing test style in that file.

- [ ] **Step 4: Run storage tests**

Run: `cd ../storage && npm test`
Expected: all pass.

- [ ] **Step 5: Run SDK tests (workspace linkage)**

Run: `cd ../sdk && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git -C ../storage add src/indicators.ts src/indicators.test.ts
git -C ../storage commit -m "feat(indicators): support metadata checkpoint on writeSeries + getLatestBar"
```

---

## Phase 3 — IndicatorHandle fast / slow paths

### Task 3.1: `indicator._sync` — incremental path for stateful types

**Files:**
- Modify: `src/handles/indicator.ts`
- Test: `src/handles/indicator-incremental.test.ts` (new)

- [ ] **Step 1: Write the failing test — happy path + fallback**

Create `src/handles/indicator-incremental.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

function mkStorage(overrides: Partial<StorageProvider['indicators']>): StorageProvider {
  return {
    tickers: {
      upsert: vi.fn().mockResolvedValue({ id: 1 }),
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
    },
    indicators: {
      upsert: vi.fn().mockResolvedValue({ id: 99 }),
      findOrCreate: vi.fn().mockResolvedValue({ id: 99 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getValue: vi.fn().mockResolvedValue(null),
      getLatestBar: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
    signals: {
      upsert: vi.fn(),
      findOrCreate: vi.fn(),
      getSeries: vi.fn(),
      writeSeries: vi.fn(),
      getLatestSeriesDate: vi.fn(),
      getLastValue: vi.fn(),
    },
    allocations: { findOrCreate: vi.fn() },
    strategies: {
      create: vi.fn(),
      getSeries: vi.fn(),
      writeSeries: vi.fn(),
      getLatestSeriesDate: vi.fn(),
      getLatestAllocationId: vi.fn(),
      resolveReference: vi.fn(),
    },
    tradingDays: {
      getRange: vi.fn().mockResolvedValue(['2026-04-20', '2026-04-21']),
      getLatestClosed: vi.fn().mockResolvedValue('2026-04-21'),
    },
  } as unknown as StorageProvider;
}

const mkMarket = (): MarketProvider => ({
  fetchBars: vi.fn().mockResolvedValue([
    { date: '2026-04-20', value: 100 },
    { date: '2026-04-21', value: 101 },
  ]),
}) as unknown as MarketProvider;

describe('IndicatorHandle._sync — incremental fast path', () => {
  it('SMA uses stored checkpoint metadata instead of recomputing from history', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
      getLatestBar: vi.fn().mockResolvedValue({
        date: '2026-04-20',
        value: 99,
        metadata: { tail: [95, 96, 97, 98, 99] },
      }),
      writeSeries: writeSpy,
    });
    const market = mkMarket();
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'SPY', leverage: 1 } as never;
    const h = new IndicatorHandle(storage, market, {
      type: 'SMA', ticker, lookback: 5, delay: 0, unit: null, threshold: null,
    });
    await h.series();
    // Fast path writes 1 new bar (the new trading day), with metadata = new tail
    const [, bars, opts] = writeSpy.mock.calls.at(-1)!;
    expect(bars.length).toBe(1);
    expect(bars[0]!.date).toBe('2026-04-21');
    expect((opts as { metadata: { tail: number[] } }).metadata.tail).toHaveLength(5);
    expect((opts as { metadata: { tail: number[] } }).metadata.tail.at(-1)).toBe(101);
  });

  it('falls back to cold compute when no checkpoint metadata exists', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getLatestBar: vi.fn().mockResolvedValue(null),
      writeSeries: writeSpy,
    });
    const market = mkMarket();
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'SPY', leverage: 1 } as never;
    const h = new IndicatorHandle(storage, market, {
      type: 'Price', ticker, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    await h.series();
    expect(writeSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/handles/indicator-incremental.test.ts`
Expected: FAIL — the first test fails because `_sync` today recomputes from full history, writes all historical bars, and does not pass `opts.metadata`.

- [ ] **Step 3: Implement the incremental path in `_sync`**

Edit `src/handles/indicator.ts`. Import `getNextComputation`, `getInitialStateFn` at the top:

```ts
import { getComputation, getNextComputation, getInitialStateFn } from '../computations/index';
```

Then replace the body of `_sync` with the incremental-aware version:

```ts
private async _sync(fromDate: string | undefined, latestClosed: string): Promise<void> {
  const tickerSymbol = this.ticker?.symbol ?? null;
  const info = getProviderInfo(this.type, tickerSymbol);
  if (info.provider === 'none') return;

  // Compute the horizon this indicator may publish up to.
  let horizon = latestClosed;
  if (this.delay > 0) {
    const tradingDays = await this._storage.tradingDays.getRange();
    const idx = tradingDays.indexOf(latestClosed);
    if (idx < this.delay) return;
    horizon = tradingDays[idx - this.delay]!;
  }

  // Fast path only applies when (a) we have a checkpoint, (b) the type is stateful
  // (has a *Next in the dispatch table), and (c) the checkpoint's date is strictly
  // less than horizon (i.e., there's at least one new bar to append).
  const nextFn = getNextComputation(this.type);
  const seedFn = getInitialStateFn(this.type);
  const { id } = await this.resolve();
  const checkpoint = nextFn ? await this._storage.indicators.getLatestBar(id) : null;

  if (
    fromDate &&
    nextFn &&
    seedFn &&
    checkpoint &&
    checkpoint.metadata != null &&
    checkpoint.date < horizon
  ) {
    // Fetch only the raw bars we need to step forward over.
    const rawBars = await this._fetchRawBarsForIncremental(info, checkpoint.date, horizon);
    if (rawBars.length === 0) return;
    const newBars: { date: string; value: number }[] = [];
    let state = checkpoint.metadata as unknown;
    for (const raw of rawBars) {
      if (raw.date <= checkpoint.date) continue;
      if (raw.date > horizon) break;
      const step = (this.type === 'Return' && info.provider === 'computed' && info.rateSeries)
        ? (await import('../computations/returns')).returnNext(
            state as { tail: number[] }, raw.value, this.lookback, 'abs',
          )
        : nextFn(state, raw.value, this.lookback);
      newBars.push({ date: raw.date, value: step.value });
      state = step.state;
    }
    if (newBars.length === 0) return;
    await this._storage.indicators.writeSeries(id, newBars, { metadata: state });
    return;
  }

  // Cold path (existing logic, now augmented to park initial-state metadata).
  let bars: DailyBar[];
  switch (info.provider) {
    case 'yahoo':
      bars = await this._market.fetchBars(info.symbol, fromDate);
      break;
    case 'fred':
      bars = await this._market.fetchBars(info.seriesId, fromDate);
      break;
    case 'computed': {
      const priceHandle = new IndicatorHandle(this._storage, this._market, {
        type: 'Price', ticker: this.ticker, lookback: 0, delay: 0, unit: null, threshold: null,
      });
      await priceHandle._ensureFresh();
      const priceBars = await priceHandle._querySeriesFromDb();
      if (this.type === 'Return') {
        bars = computeReturns(priceBars, this.lookback, info.rateSeries ? 'abs' : 'pct');
      } else {
        const computeFn = getComputation(this.type);
        if (!computeFn) throw new Error(`No computation found for type "${this.type}"`);
        bars = computeFn(priceBars, this.lookback);
      }
      if (fromDate) bars = bars.filter((b) => b.date > fromDate);
      break;
    }
    case 'calendar': {
      const allDays = await this._storage.tradingDays.getRange();
      const dayBars: DailyBar[] = allDays.map((date) => ({ date, value: 0 }));
      bars = computeCalendar(dayBars, this.type as 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year');
      if (fromDate) bars = bars.filter((b) => b.date > fromDate);
      break;
    }
  }

  if (info.provider !== 'computed') {
    bars = await this._applyLeverage(bars, fromDate);
  }
  bars = bars.filter((b) => b.date <= horizon);
  if (bars.length === 0) return;

  // For stateful types, derive and park the terminal metadata so subsequent
  // syncs take the fast path.
  let metadata: unknown = undefined;
  if (seedFn) {
    // For stateful COMPUTED types, seed from the full price bars up to horizon;
    // for stateful FETCHED types (none in current code, but future-safe) seed
    // from the bars we're about to write.
    if (info.provider === 'computed') {
      const priceHandle = new IndicatorHandle(this._storage, this._market, {
        type: 'Price', ticker: this.ticker, lookback: 0, delay: 0, unit: null, threshold: null,
      });
      const priceBars = (await priceHandle._querySeriesFromDb()).filter((b) => b.date <= horizon);
      metadata = seedFn(priceBars, this.lookback) ?? undefined;
    } else {
      metadata = seedFn(bars, this.lookback) ?? undefined;
    }
  }

  await this._upsertSeries(bars, metadata);
}

private async _fetchRawBarsForIncremental(
  info: ReturnType<typeof getProviderInfo>,
  sinceDate: string,
  horizon: string,
): Promise<DailyBar[]> {
  if (info.provider === 'computed') {
    const priceHandle = new IndicatorHandle(this._storage, this._market, {
      type: 'Price', ticker: this.ticker, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    await priceHandle._ensureFresh();
    return (await priceHandle._querySeriesFromDb({ from: sinceDate })).filter(
      (b) => b.date > sinceDate && b.date <= horizon,
    );
  }
  if (info.provider === 'yahoo' || info.provider === 'fred') {
    const symbol = info.provider === 'yahoo' ? info.symbol : info.seriesId;
    const bars = await this._market.fetchBars(symbol, sinceDate);
    return bars.filter((b) => b.date > sinceDate && b.date <= horizon);
  }
  if (info.provider === 'calendar') {
    const allDays = await this._storage.tradingDays.getRange();
    const dayBars: DailyBar[] = allDays.map((date) => ({ date, value: 0 }));
    return computeCalendar(
      dayBars,
      this.type as 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year',
    ).filter((b) => b.date > sinceDate && b.date <= horizon);
  }
  return [];
}
```

Also update `_upsertSeries` to forward the metadata option:

```ts
private async _upsertSeries(bars: DailyBar[], metadata?: unknown): Promise<void> {
  const { id } = await this.resolve();
  await this._storage.indicators.writeSeries(
    id,
    bars,
    metadata !== undefined ? { metadata } : undefined,
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/handles/indicator-incremental.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS overall (pre-existing tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/handles/indicator.ts src/handles/indicator-incremental.test.ts
git commit -m "feat(indicator): incremental _sync via checkpoint metadata"
```

---

### Task 3.2: `indicator.computeAt` — fast path when checkpoint is yesterday

**Files:**
- Modify: `src/handles/indicator.ts`
- Test: `src/handles/indicator-incremental.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `src/handles/indicator-incremental.test.ts`:

```ts
describe('IndicatorHandle.computeAt — fast path', () => {
  it('uses rsiNext from checkpoint when checkpoint is yesterday', async () => {
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
      getLatestBar: vi.fn().mockResolvedValue({
        date: '2026-04-20',
        value: 55,
        metadata: { avgGain: 1.2, avgLoss: 0.8, prev: 100 },
      }),
    });
    const market = mkMarket();
    (storage.tradingDays.getRange as ReturnType<typeof vi.fn>).mockResolvedValue(['2026-04-20', '2026-04-21']);
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'SPY', leverage: 1 } as never;
    const h = new IndicatorHandle(storage, market, {
      type: 'RSI', ticker, lookback: 14, delay: 0, unit: null, threshold: null,
    });
    const v = await h.computeAt('2026-04-21', { SPY: 101 });
    expect(v).not.toBeNull();
    // computeAt should NOT have called the full bounded-window recompute; the
    // checkpoint path calls only the raw-bar resolver + one rsiNext step.
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/handles/indicator-incremental.test.ts`
Expected: FAIL — current `computeAt` always takes the bounded-window path for stateful computed types.

- [ ] **Step 3: Implement the fast path in `computeAt`**

In `src/handles/indicator.ts`, at the start of the `info.provider === 'computed'` block inside `computeAt`, insert:

```ts
// Fast path: checkpoint is the trading day immediately before `date`.
const nextFn = getNextComputation(this.type);
if (nextFn) {
  const { id } = await this.resolve();
  const checkpoint = await this._storage.indicators.getLatestBar(id);
  if (checkpoint && checkpoint.metadata != null) {
    const tradingDays = await this._storage.tradingDays.getRange();
    const ckIdx = tradingDays.indexOf(checkpoint.date);
    const tgtIdx = tradingDays.indexOf(date);
    if (ckIdx >= 0 && tgtIdx === ckIdx + 1) {
      const rawBar = await this._resolveRawBarAt(info.symbol, date, overrides);
      if (rawBar === null) return null;
      const step = (this.type === 'Return' && info.rateSeries)
        ? returnNext(
            checkpoint.metadata as { tail: number[] },
            rawBar,
            this.lookback,
            'abs',
          )
        : nextFn(checkpoint.metadata, rawBar, this.lookback);
      return step.value;
    }
  }
}
```

Add a helper `_resolveRawBarAt` next to `_resolveRawBars` that delegates to the existing symbol-dispatching path for a one-day window:

```ts
private async _resolveRawBarAt(
  symbol: string,
  date: string,
  overrides?: Record<string, number>,
): Promise<number | null> {
  const override = overrides?.[symbol];
  if (override !== undefined) return override;
  const bars = await this._resolveRawBars(symbol, date, date, overrides);
  const hit = bars.find((b) => b.date === date);
  return hit?.value ?? null;
}
```

Add imports if needed:

```ts
import { returnNext } from '../computations/returns';
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/handles/indicator-incremental.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS overall.

- [ ] **Step 5: Commit**

```bash
git add src/handles/indicator.ts src/handles/indicator-incremental.test.ts
git commit -m "feat(indicator): computeAt fast path via checkpoint + single raw bar"
```

---

## Phase 4 — SignalHandle single-bar fast path

### Task 4.1: `signal._sync` — skip full indicator series fetch when only one new bar is needed

**Files:**
- Modify: `src/handles/signal.ts`
- Test: `src/handles/signal-incremental.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/handles/signal-incremental.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SignalHandle } from './signal';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

describe('SignalHandle._sync — single-bar fast path', () => {
  it('uses indicator.computeAt + getLastValue when catching up exactly one trading day', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const ind1Series = vi.fn(); // must not be called in fast path
    const ind2Series = vi.fn();
    const ind1ComputeAt = vi.fn().mockResolvedValue(105);
    const ind2ComputeAt = vi.fn().mockResolvedValue(100);

    const storage: StorageProvider = {
      tickers: { upsert: vi.fn(), findOrCreate: vi.fn() },
      indicators: { } as StorageProvider['indicators'],
      signals: {
        upsert: vi.fn(),
        findOrCreate: vi.fn().mockResolvedValue({ id: 42 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: writeSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
        getLastValue: vi.fn().mockResolvedValue(0),
      },
      allocations: { findOrCreate: vi.fn() },
      strategies: {} as StorageProvider['strategies'],
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(['2026-04-20', '2026-04-21']),
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-21'),
      },
    };

    const indicator1 = {
      resolve: vi.fn().mockResolvedValue({ id: 1 }),
      series: ind1Series,
      computeAt: ind1ComputeAt,
      type: 'Price',
    } as never;
    const indicator2 = {
      resolve: vi.fn().mockResolvedValue({ id: 2 }),
      series: ind2Series,
      computeAt: ind2ComputeAt,
      type: 'Price',
    } as never;

    const market = {} as MarketProvider;
    const h = new SignalHandle(storage, market, {
      indicator1, indicator2, comparison: '>', tolerance: 0,
    });
    await h.series();

    expect(ind1ComputeAt).toHaveBeenCalledWith('2026-04-21', undefined);
    expect(ind2ComputeAt).toHaveBeenCalledWith('2026-04-21', undefined);
    expect(ind1Series).not.toHaveBeenCalled();
    expect(ind2Series).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [, bars] = writeSpy.mock.calls.at(-1)!;
    expect(bars).toEqual([{ date: '2026-04-21', value: 1 }]); // 105 > 100
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/handles/signal-incremental.test.ts`
Expected: FAIL — current `_sync` calls both `indicator.series(range)` paths.

- [ ] **Step 3: Implement**

Replace the body of `_sync` in `src/handles/signal.ts` with:

```ts
private async _sync(fromDate: string | undefined, latestClosed: string): Promise<void> {
  const { id } = await this.resolve();

  const absolute = ABSOLUTE_TOLERANCE_TYPES.has(this.indicator1.type);

  // Single-bar fast path: we have a checkpoint (fromDate), and the next bar to
  // produce is the trading day immediately after fromDate.
  if (fromDate) {
    const tradingDays = await this._storage.tradingDays.getRange();
    const fromIdx = tradingDays.indexOf(fromDate);
    const closedIdx = tradingDays.indexOf(latestClosed);
    if (fromIdx >= 0 && closedIdx === fromIdx + 1) {
      const newDate = tradingDays[closedIdx]!;
      const [v1, v2] = await Promise.all([
        this.indicator1.computeAt(newDate),
        this.indicator2.computeAt(newDate),
      ]);
      if (v1 === null || v2 === null) return;
      const prev = (await this._getLastSignalValue(id)) ?? undefined;
      const value = this._evaluateOneBar(v1, v2, absolute, prev);
      await this._upsertSeries([{ date: newDate, value }]);
      return;
    }
  }

  // Existing multi-bar / cold path.
  const range = fromDate ? { from: fromDate } : undefined;
  const [series1, series2] = await Promise.all([this.indicator1.series(range), this.indicator2.series(range)]);
  const previousValue = fromDate ? ((await this._getLastSignalValue(id)) ?? undefined) : undefined;
  const signalBars = evaluateSignal(series1, series2, this.comparison, this.tolerance, absolute, previousValue);
  const bars = signalBars.filter((b) => b.date <= latestClosed);
  if (bars.length > 0) await this._upsertSeries(bars);
}

private _evaluateOneBar(v1: number, v2: number, absolute: boolean, prev: number | undefined): number {
  if (this.tolerance === 0) {
    switch (this.comparison) {
      case '>': return v1 > v2 ? 1 : 0;
      case '<': return v1 < v2 ? 1 : 0;
      case '=': return v1 === v2 ? 1 : 0;
    }
  }
  const upper = absolute ? v2 + this.tolerance : v2 * (1 + this.tolerance / 100);
  const lower = absolute ? v2 - this.tolerance : v2 * (1 - this.tolerance / 100);
  if (this.comparison === '=') return v1 >= lower && v1 <= upper ? 1 : 0;
  if (prev === undefined) {
    return this.comparison === '>' ? (v1 > v2 ? 1 : 0) : (v1 < v2 ? 1 : 0);
  }
  if (this.comparison === '>') {
    return prev === 1 ? (v1 < lower ? 0 : 1) : (v1 > upper ? 1 : 0);
  }
  return prev === 1 ? (v1 > upper ? 0 : 1) : (v1 < lower ? 1 : 0);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/handles/signal-incremental.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS overall.

- [ ] **Step 5: Commit**

```bash
git add src/handles/signal.ts src/handles/signal-incremental.test.ts
git commit -m "feat(signal): single-bar fast path using indicator.computeAt"
```

---

## Phase 5 — StrategyHandle checkpointed `_evaluate`

### Task 5.1: Rewrite `_evaluate` to consume the strategy checkpoint

**Files:**
- Modify: `src/handles/strategy.ts`
- Test: `src/handles/strategy-incremental.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/handles/strategy-incremental.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { StrategyHandle } from './strategy';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

describe('StrategyHandle._evaluate — checkpointed', () => {
  it('only emits entries for dates after the strategy checkpoint', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const signalGetSeriesSpy = vi.fn().mockResolvedValue([{ date: '2026-04-21', value: 1 }]);

    const storage: StorageProvider = {
      tickers: { upsert: vi.fn(), findOrCreate: vi.fn() },
      indicators: {} as StorageProvider['indicators'],
      signals: {
        upsert: vi.fn(),
        findOrCreate: vi.fn().mockResolvedValue({ id: 50 }),
        getSeries: signalGetSeriesSpy,
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-21'),
        getLastValue: vi.fn().mockResolvedValue(1),
      },
      allocations: { findOrCreate: vi.fn().mockResolvedValue({ id: 7 }) },
      strategies: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: writeSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
        getLatestAllocationId: vi.fn().mockResolvedValue(7),
        resolveReference: vi.fn(),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(['2026-04-19', '2026-04-20', '2026-04-21']),
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-21'),
      },
    };

    // Build a single-rule fallback strategy (no signals) that always holds the
    // allocation. This exercises the carry-forward from lastAllocId without
    // needing any signal evaluation.
    const cashxTicker = {
      resolve: vi.fn().mockResolvedValue({ id: 10 }),
      symbol: 'CASHX',
      leverage: 1,
    } as never;
    const allocation = {
      resolve: vi.fn().mockResolvedValue({ id: 7 }),
      id: 7,
      holdings: [[cashxTicker, 1]],
    } as never;
    const market = { fetchBars: vi.fn().mockResolvedValue([]) } as unknown as MarketProvider;
    const strat = new StrategyHandle(storage, market, {
      name: 's', freq: 'Daily', offset: 0, rules: [{ hold: allocation }],
    });
    await (strat as unknown as { resolve: () => Promise<{ id: number }> }).resolve();
    // Trigger the post-close sync path via series(); _ensureFresh calls _evaluate.
    await strat.series();

    // Verify entries only cover 2026-04-21 (the single new day after the checkpoint).
    const writeCall = writeSpy.mock.calls.at(-1)!;
    const entries = writeCall[1] as { date: string; allocationId: number }[];
    expect(entries.map((e) => e.date)).toEqual(['2026-04-21']);
    expect(entries[0]!.allocationId).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/handles/strategy-incremental.test.ts`
Expected: FAIL — current `_evaluate` re-maps full signal history and emits entries for all trading days.

- [ ] **Step 3: Rewrite `_evaluate`**

Replace `_evaluate` in `src/handles/strategy.ts` with:

```ts
private async _evaluate(
  limitDate: string,
  overrides?: Record<string, number>,
): Promise<{ allocations: AllocationHandle[]; entries: StrategySeriesEntry[] }> {
  const { id } = await this.resolve();
  const lastDate = await this._storage.strategies.getLatestSeriesDate(id);
  const lastAllocId = await this._storage.strategies.getLatestAllocationId(id);

  const tradingDays = await this._storage.tradingDays.getRange();
  const limitIdx = tradingDays.indexOf(limitDate);

  // Build the allocation index map exactly once per call.
  const allocations: AllocationHandle[] = [];
  const allocIndexMap = new Map<number, number>();
  const rulesInput = this._rules.map((rule) => {
    let allocIdx = allocIndexMap.get(rule.hold.id);
    if (allocIdx === undefined) {
      allocIdx = allocations.length;
      allocations.push(rule.hold);
      allocIndexMap.set(rule.hold.id, allocIdx);
    }
    return {
      signalIds: (rule.when ?? []).map((s) => s.id),
      allocationIndex: allocIdx,
    };
  });

  // Bootstrap: no checkpoint yet → fall back to full history compute.
  if (lastDate === null) {
    return this._evaluateCold(limitDate, overrides, rulesInput, allocations, tradingDays);
  }

  // Incremental window: (lastDate, limitDate], bounded by tradingDays.
  const startIdx = tradingDays.indexOf(lastDate) + 1;
  const newDays = tradingDays.slice(startIdx, limitIdx + 1);
  if (newDays.length === 0) return { allocations, entries: [] };

  // Build signal bar maps only for the new window.
  const allSignals = new Set<SignalHandle>();
  for (const rule of this._rules) if (rule.when) rule.when.forEach((s) => allSignals.add(s));
  const signalSeries = new Map<number, Map<string, boolean>>();
  await Promise.all(
    Array.from(allSignals).map(async (signal) => {
      const bars =
        overrides === undefined
          ? await signal.series({ from: newDays[0]!, to: limitDate })
          : await this._storage.signals.getSeries(signal.id, { from: newDays[0]!, to: limitDate });
      const dateMap = new Map<string, boolean>();
      for (const bar of bars) dateMap.set(bar.date, bar.value === 1);
      if (overrides !== undefined) {
        const prevDateIdx = startIdx - 1 >= 0 ? tradingDays[startIdx - 1] : undefined;
        const prevBool =
          prevDateIdx !== undefined ? ((await signal.value(prevDateIdx)) === 1) : null;
        const todayValue = await signal.computeAt(limitDate, overrides, prevBool);
        if (todayValue !== null) dateMap.set(limitDate, todayValue);
      }
      signalSeries.set(signal.id, dateMap);
    }),
  );

  const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);

  // Walk new days, carrying forward `current` from the checkpoint allocation.
  const entries: StrategySeriesEntry[] = [];
  let current: number | undefined =
    lastAllocId !== null ? (allocIndexMap.get(lastAllocId) ?? undefined) : undefined;

  for (const date of newDays) {
    if (rebalanceDates.has(date)) {
      for (const rule of rulesInput) {
        if (rule.signalIds.length === 0) {
          current = rule.allocationIndex;
          break;
        }
        const allTrue = rule.signalIds.every((sid) => signalSeries.get(sid)?.get(date) ?? false);
        if (allTrue) {
          current = rule.allocationIndex;
          break;
        }
      }
    }
    if (current !== undefined) {
      entries.push({ date, allocationId: allocations[current]!.id });
    }
  }

  return { allocations, entries };
}

// Renamed body of the old _evaluate — used only for first-ever evaluate (bootstrap).
private async _evaluateCold(
  limitDate: string,
  overrides: Record<string, number> | undefined,
  rulesInput: { signalIds: number[]; allocationIndex: number }[],
  allocations: AllocationHandle[],
  tradingDays: string[],
): Promise<{ allocations: AllocationHandle[]; entries: StrategySeriesEntry[] }> {
  // (Existing full-history evaluation logic: build signalSeries from full history,
  // compute rebalanceDates, run evaluateStrategy, filter to limitDate.)
  const allSignals = new Set<SignalHandle>();
  for (const rule of this._rules) if (rule.when) rule.when.forEach((s) => allSignals.add(s));
  const signalSeries = new Map<number, Map<string, boolean>>();
  if (overrides === undefined) {
    await Promise.all(
      Array.from(allSignals).map(async (signal) => {
        const bars = await signal.series();
        const dateMap = new Map<string, boolean>();
        for (const bar of bars) dateMap.set(bar.date, bar.value === 1);
        signalSeries.set(signal.id, dateMap);
      }),
    );
  } else {
    const limitIdx = tradingDays.indexOf(limitDate);
    const prevDate = limitIdx > 0 ? tradingDays[limitIdx - 1] : undefined;
    await Promise.all(
      Array.from(allSignals).map(async (signal) => {
        const historical = await this._storage.signals.getSeries(signal.id);
        const dateMap = new Map<string, boolean>();
        for (const bar of historical) dateMap.set(bar.date, bar.value === 1);
        const prevBool = prevDate !== undefined ? (dateMap.get(prevDate) ?? null) : null;
        const todayValue = await signal.computeAt(limitDate, overrides, prevBool);
        if (todayValue !== null) dateMap.set(limitDate, todayValue);
        signalSeries.set(signal.id, dateMap);
      }),
    );
  }
  const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);
  const evalResult = evaluateStrategy(signalSeries, rulesInput, rebalanceDates, tradingDays);
  const entries: StrategySeriesEntry[] = Array.from(evalResult.entries())
    .filter(([date]) => date <= limitDate)
    .map(([date, allocIdx]) => ({ date, allocationId: allocations[allocIdx]!.id }));
  return { allocations, entries };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/handles/strategy-incremental.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS overall (existing strategy tests still green because cold path is preserved for strategies with no prior series).

- [ ] **Step 5: Commit**

```bash
git add src/handles/strategy.ts src/handles/strategy-incremental.test.ts
git commit -m "feat(strategy): checkpointed _evaluate with cold bootstrap fallback"
```

---

## Phase 6 — End-to-end verification

### Task 6.1: Parity test — cold → incremental equivalence (indicator)

**Files:**
- Test: `src/handles/indicator-parity.test.ts` (new)

- [ ] **Step 1: Write the parity test**

Create `src/handles/indicator-parity.test.ts`. The test uses an in-memory storage that persists both values and metadata keyed by `(indicator_id, date)` and iterates each stateful type against a deterministic 300-bar price series. For each type it runs the cold path to populate history, then deletes the last 3 rows, re-runs sync (hitting the incremental path), and asserts byte-identical series.

```ts
import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

function makeInMemoryStorage(dates: string[]) {
  // Rows keyed by `${indicatorId}::${date}`
  const rows = new Map<string, { value: number; metadata: unknown }>();
  const indicatorIds = new Map<string, number>();
  let nextId = 1;

  function identityKey(identity: {
    type: string; tickerId: number | null; lookback: number; delay: number;
    unit: string | null; threshold: number | null;
  }) {
    return JSON.stringify(identity);
  }

  return {
    rows,
    storage: {
      tickers: {
        upsert: vi.fn().mockResolvedValue({ id: 1 }),
        findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
      },
      indicators: {
        upsert: vi.fn(),
        findOrCreate: async (identity: Parameters<StorageProvider['indicators']['findOrCreate']>[0]) => {
          const k = identityKey(identity);
          if (!indicatorIds.has(k)) indicatorIds.set(k, nextId++);
          return { id: indicatorIds.get(k)! };
        },
        getSeries: async (indicatorId: number, range?: { from?: string; to?: string }) => {
          const bars: { date: string; value: number }[] = [];
          for (const [k, v] of rows) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) !== indicatorId) continue;
            if (range?.from && d! < range.from) continue;
            if (range?.to && d! > range.to) continue;
            bars.push({ date: d!, value: v.value });
          }
          return bars.sort((a, b) => a.date.localeCompare(b.date));
        },
        writeSeries: async (
          indicatorId: number,
          bars: { date: string; value: number }[],
          opts?: { metadata?: unknown },
        ) => {
          for (const b of bars) rows.set(`${indicatorId}::${b.date}`, { value: b.value, metadata: null });
          if (opts?.metadata !== undefined && bars.length > 0) {
            const maxDate = bars.reduce((m, b) => (b.date > m ? b.date : m), bars[0]!.date);
            rows.set(`${indicatorId}::${maxDate}`, {
              value: rows.get(`${indicatorId}::${maxDate}`)!.value,
              metadata: opts.metadata,
            });
            for (const [k, v] of rows) {
              if (!k.startsWith(`${indicatorId}::`)) continue;
              const d = k.split('::')[1]!;
              if (d < maxDate && v.metadata != null) rows.set(k, { value: v.value, metadata: null });
            }
          }
        },
        getLatestSeriesDate: async (indicatorId: number) => {
          let max: string | null = null;
          for (const k of rows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === indicatorId && (max === null || d! > max)) max = d!;
          }
          return max;
        },
        getValue: async (indicatorId: number, date?: string) => {
          if (date) return rows.get(`${indicatorId}::${date}`)?.value ?? null;
          let max: string | null = null;
          for (const k of rows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === indicatorId && (max === null || d! > max)) max = d!;
          }
          return max ? (rows.get(`${indicatorId}::${max}`)?.value ?? null) : null;
        },
        getLatestBar: async (indicatorId: number) => {
          let max: string | null = null;
          for (const k of rows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === indicatorId && (max === null || d! > max)) max = d!;
          }
          if (!max) return null;
          const row = rows.get(`${indicatorId}::${max}`)!;
          return { date: max, value: row.value, metadata: row.metadata };
        },
      },
      signals: {} as StorageProvider['signals'],
      allocations: { findOrCreate: vi.fn() },
      strategies: {} as StorageProvider['strategies'],
      tradingDays: {
        getRange: async () => dates,
        getLatestClosed: async () => dates[dates.length - 1]!,
      },
    } as unknown as StorageProvider,
  };
}

function syntheticPrices(dates: string[]): { date: string; value: number }[] {
  let x = 101;
  return dates.map((date, i) => {
    x = (x * 1664525 + 1013904223 + i) % 4294967296;
    return { date, value: 100 + (x % 10000) / 100 };
  });
}

describe('indicator cold→incremental parity', () => {
  const dates: string[] = [];
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= 25; d++) {
      dates.push(`2020-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }

  for (const { type, lookback } of [
    { type: 'SMA' as const, lookback: 20 },
    { type: 'EMA' as const, lookback: 20 },
    { type: 'RSI' as const, lookback: 14 },
    { type: 'Return' as const, lookback: 10 },
    { type: 'Volatility' as const, lookback: 20 },
    { type: 'Drawdown' as const, lookback: 20 },
  ]) {
    it(`${type}(${lookback}) is byte-identical between cold and incremental`, async () => {
      const { rows, storage } = makeInMemoryStorage(dates);
      const prices = syntheticPrices(dates);
      const market: MarketProvider = {
        fetchBars: vi.fn(async () => prices),
      } as unknown as MarketProvider;
      const ticker = {
        resolve: vi.fn().mockResolvedValue({ id: 1 }),
        symbol: 'SPY',
        leverage: 1,
      } as never;

      const h1 = new IndicatorHandle(storage, market, {
        type, ticker, lookback, delay: 0, unit: null, threshold: null,
      });
      await h1.series();
      const cold = await h1.series();

      // Delete last 3 rows of the stateful indicator's series.
      const { id: coldId } = await h1.resolve();
      for (let i = dates.length - 3; i < dates.length; i++) {
        rows.delete(`${coldId}::${dates[i]!}`);
      }

      const h2 = new IndicatorHandle(storage, market, {
        type, ticker, lookback, delay: 0, unit: null, threshold: null,
      });
      const incr = await h2.series();

      expect(incr.length).toBe(cold.length);
      for (let i = 0; i < cold.length; i++) {
        expect(incr[i]!.date).toBe(cold[i]!.date);
        expect(incr[i]!.value).toBeCloseTo(cold[i]!.value, 10);
      }
    });
  }
});
```

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run src/handles/indicator-parity.test.ts`
Expected: all 6 type scenarios PASS.

- [ ] **Step 3: Commit**

```bash
git add src/handles/indicator-parity.test.ts
git commit -m "test(indicator): cold→incremental parity across stateful types"
```

---

### Task 6.2: Benchmark script

**Files:**
- Create: `bench/incremental.bench.ts`

- [ ] **Step 1: Write the benchmark**

Create `bench/incremental.bench.ts` using the in-memory storage factory from Task 6.1 (extract it to `src/handles/__fixtures__/in-memory-storage.ts` first and import from both places; make this refactor part of this step). The benchmark pre-seeds 15,000 trading days plus a 10-indicator strategy, runs the full cold sync once (not timed), then measures 100 `previewAllocation` calls:

```ts
import { performance } from 'node:perf_hooks';
import { makeInMemoryStorage, syntheticPrices } from '../src/handles/__fixtures__/in-memory-storage';
import { StrategyHandle } from '../src/handles/strategy';
import { IndicatorHandle } from '../src/handles/indicator';
import { SignalHandle } from '../src/handles/signal';
import { AllocationHandle } from '../src/handles/allocation';
import { TickerHandle } from '../src/handles/ticker';
import type { MarketProvider } from '../src/providers/market';

async function main() {
  // 15k trading days
  const dates: string[] = [];
  const base = new Date('1970-01-02');
  for (let i = 0; i < 15000; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const { storage } = makeInMemoryStorage(dates);
  const prices = syntheticPrices(dates);
  const market: MarketProvider = { fetchBars: async () => prices } as unknown as MarketProvider;

  const spy = new TickerHandle(storage, 'SPY', 1);
  const qqq = new TickerHandle(storage, 'QQQ', 1);
  const cashx = new TickerHandle(storage, 'CASHX', 1);

  // 10 indicators: SMAs and RSIs on SPY + QQQ of varied lookbacks
  const indicators: IndicatorHandle[] = [];
  for (const ticker of [spy, qqq]) {
    for (const lookback of [10, 20, 50, 100, 200]) {
      indicators.push(new IndicatorHandle(storage, market, {
        type: 'SMA', ticker, lookback, delay: 0, unit: null, threshold: null,
      }));
    }
  }

  const price = new IndicatorHandle(storage, market, {
    type: 'Price', ticker: spy, lookback: 0, delay: 0, unit: null, threshold: null,
  });

  const sig = new SignalHandle(storage, market, {
    indicator1: price, indicator2: indicators[0]!, comparison: '>', tolerance: 0,
  });

  const alloc = new AllocationHandle(storage, [[spy, 1]]);
  const cash = new AllocationHandle(storage, [[cashx, 1]]);

  const strat = new StrategyHandle(storage, market, {
    name: 'bench', freq: 'Daily', offset: 0,
    rules: [{ when: [sig], hold: alloc }, { hold: cash }],
  });

  // Warm: cold sync + first preview (not timed)
  await strat.series();
  await strat.previewAllocation(dates[dates.length - 1]!, { SPY: 500, QQQ: 400 });

  const iterations = 100;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    await strat.previewAllocation(dates[dates.length - 1]!, { SPY: 500 + i, QQQ: 400 + i });
  }
  const t1 = performance.now();
  console.log(`previewAllocation avg: ${((t1 - t0) / iterations).toFixed(2)} ms`);
}

void main();
```

Before running, extract `makeInMemoryStorage` and `syntheticPrices` from `src/handles/indicator-parity.test.ts` into `src/handles/__fixtures__/in-memory-storage.ts` so both the test and the benchmark can import them without duplication.

- [ ] **Step 2: Run the benchmark**

Run: `npx tsx bench/incremental.bench.ts`
Expected: a single line of output with the avg ms. Target <50 ms, but more importantly: steady-state calls stay in ms territory, not scaling with history size. Record the number in the commit message.

- [ ] **Step 3: Commit**

```bash
git add bench/incremental.bench.ts
git commit -m "bench: add incremental previewAllocation benchmark"
```

---

### Task 6.3: Run the full test suite + lint + build

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean `dist/` output.

- [ ] **Step 4: Final commit (if any format/lint fixups were needed)**

```bash
git add .
git commit -m "chore: format/lint fixups for incremental evaluation"
```

---

## Rollback plan

Each phase lands in its own commit(s). Reverting in reverse order (strategy → signal → indicator computeAt → indicator _sync → storage interface → computations) leaves the codebase on the pre-feature behaviour, because:
- Every new code path is guarded by `if (nextFn && checkpoint && ...)` — falling through to the existing cold path when the guard fails.
- The `metadata` JSON column is populated by writes but never read by code paths other than the new ones — reverting the handles makes the column dormant again.

No data cleanup is required on revert; the only impact is that `indicators_series.metadata` rows carrying checkpoint state become dead weight until a subsequent revert-of-revert reads them again.
