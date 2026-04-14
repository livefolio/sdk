# PriceStream Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PriceStream` interface to the SDK that defines the contract for real-time price streaming with dynamic symbol subscription.

**Architecture:** Single type-only file in `src/providers/`, exported from the SDK barrel. No implementation — just the interface and a status type alias. Follows the existing `MarketProvider` pattern.

**Tech Stack:** TypeScript (strict mode)

**Spec:** `docs/specs/2026-04-13-price-stream-design.md`

---

### Task 1: Create the PriceStream interface

**Files:**
- Create: `src/providers/price-stream.ts`

- [ ] **Step 1: Create the type file**

```ts
export type StreamStatus = 'connected' | 'disconnected' | 'reconnecting';

export interface PriceStream {
  subscribe(...symbols: string[]): void;
  unsubscribe(...symbols: string[]): void;

  on(event: 'tick', cb: (symbol: string, price: number) => void): void;
  on(event: 'status', cb: (status: StreamStatus) => void): void;
  on(event: 'error', cb: (error: Error) => void): void;

  off(event: 'tick', cb: (symbol: string, price: number) => void): void;
  off(event: 'status', cb: (status: StreamStatus) => void): void;
  off(event: 'error', cb: (error: Error) => void): void;

  close(): void;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/providers/price-stream.ts
git commit -m "feat: add PriceStream interface for real-time price streaming"
```

---

### Task 2: Export from SDK barrel

**Files:**
- Modify: `src/index.ts:3-4` (add export after `MarketProvider` line)

- [ ] **Step 1: Add the export**

Add after line 4 (`export type { MarketProvider } from './providers/market';`):

```ts
export type { PriceStream, StreamStatus } from './providers/price-stream';
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify the export is accessible**

Run: `npx tsc --noEmit -p tsconfig.json && echo "OK"`
Expected: OK

- [ ] **Step 4: Run existing tests to check for regressions**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: export PriceStream and StreamStatus from SDK barrel"
```
