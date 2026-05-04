# `@livefolio/fred` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `@livefolio/fred@0.1.0` adapter package — a `DataFeed` implementation that exposes FRED (St. Louis Fed) macro time series as degenerate OHLCV bars, designed to plug into `RoutingDataFeed`'s `macro` slot.

**Architecture:** New sibling repo at `/Users/raksi/Documents/Personal/livefolio-2/fred/` that mirrors `@livefolio/yfinance` 1:1. Composition `assetToFredSeriesId → BarCache → fetchFredObservations`. Native `fetch` for HTTP; no runtime deps. Per-instance cache + inflight dedup so a backtest fetches each series once.

**Tech Stack:** TypeScript (strict, ESM), Vitest, tsup. Peer dep `@livefolio/sdk@^0.4.0` (locally `file:../sdk`). Companion spec: `docs/specs/2026-05-03-fred-adapter-design.md`.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `fred/package.json` | Create | Package manifest, mirrors yfinance |
| `fred/tsconfig.json` | Create | Strict TS, ESM, bundler resolution + sdk path aliases |
| `fred/tsup.config.ts` | Create | Bundler config, sdk marked external |
| `fred/vitest.config.ts` | Create | Test config + sdk source aliases |
| `fred/eslint.config.js` | Create | Flat config, copied from yfinance |
| `fred/.prettierrc` | Create | Match yfinance/SDK formatting |
| `fred/.gitignore` | Create | node_modules / dist / log / DS_Store |
| `fred/LICENSE` | Create | MIT, copied from sdk |
| `fred/README.md` | Create | Public-facing README |
| `fred/AGENTS.md` | Create | Agent guide, parallel to yfinance/AGENTS.md |
| `fred/CLAUDE.md` | Create | One-line redirect to AGENTS.md |
| `fred/docs/specs/2026-05-03-fred-adapter-design.md` | Create (copy) | Canonical design spec |
| `fred/src/asset.ts` | Create | `assetToFredSeriesId(asset)` |
| `fred/src/asset.test.ts` | Create | Asset normalization tests |
| `fred/src/cache.ts` | Create | `BarCache` (port from yfinance) |
| `fred/src/cache.test.ts` | Create | Cache tests (port from yfinance) |
| `fred/src/fred-client.ts` | Create | `fetchFredObservations(seriesId, range, opts)` |
| `fred/src/fred-client.test.ts` | Create | HTTP client tests (mocked fetch) |
| `fred/src/fred-data-feed.ts` | Create | `FredDataFeed implements DataFeed` |
| `fred/src/fred-data-feed.test.ts` | Create | Feed-level tests (injected fetcher) |
| `fred/src/index.ts` | Create | Barrel exports |
| `fred/src/integration.test.ts` | Create | Live FRED hit, gated on env |

---

### Task 1: Scaffold the `@livefolio/fred` repo

**Goal:** Create the new package directory at `/Users/raksi/Documents/Personal/livefolio-2/fred/` with all config files, docs scaffolding, and an empty `src/` ready for code. Initialize as a git repo on `main` and verify `npm install` resolves the peer dep against the local SDK.

**Files:**
- Create directory: `/Users/raksi/Documents/Personal/livefolio-2/fred/`
- Create: all files listed in the File Structure section above except the `src/*.ts` files (those land in later tasks)

**Acceptance Criteria:**
- [ ] `fred/` exists with subdirectories `src/`, `docs/specs/`, `docs/plans/`
- [ ] All config files match the yfinance template adapted for FRED (no `yahoo-finance2` dep, no `workspaces`, no fixture-recording script)
- [ ] `npm install` succeeds in `fred/` and creates `node_modules/@livefolio/sdk` linking to `../sdk`
- [ ] `npm test` runs (passes with zero tests via `passWithNoTests: true`)
- [ ] `npm run lint` runs cleanly on the empty `src/`
- [ ] `git init`, initial commit on branch `main`

**Verify:**
```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm install && npm test && npm run lint && git log --oneline
```
Expected: install OK, test OK (no tests), lint clean, one initial commit visible.

**Steps:**

- [ ] **Step 1: Create the directory tree**

```bash
mkdir -p /Users/raksi/Documents/Personal/livefolio-2/fred/src
mkdir -p /Users/raksi/Documents/Personal/livefolio-2/fred/docs/specs
mkdir -p /Users/raksi/Documents/Personal/livefolio-2/fred/docs/plans
```

- [ ] **Step 2: Write `fred/package.json`**

```json
{
  "name": "@livefolio/fred",
  "version": "0.1.0",
  "description": "FRED (St. Louis Fed) macro time series adapter for @livefolio/sdk v0.4. Node-only DataFeed implementation; pass-through observations as OHLCV bars.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "keywords": [
    "fred",
    "macro",
    "datafeed",
    "backtest",
    "livefolio",
    "tactical-allocation"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/livefolio/fred.git"
  },
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write 'src/**/*.ts'",
    "format:check": "prettier --check 'src/**/*.ts'",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "@livefolio/sdk": "^0.4.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@livefolio/sdk": "file:../sdk",
    "@types/node": "^25.6.0",
    "eslint": "^10.1.0",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-prettier": "^5.5.5",
    "prettier": "3.8.1",
    "tsup": "^8.5.1",
    "tsx": "^4.21.0",
    "typescript": "^5.8",
    "typescript-eslint": "^8.58.0",
    "vitest": "^3"
  }
}
```

- [ ] **Step 3: Write `fred/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": {
      "@livefolio/sdk": ["./node_modules/@livefolio/sdk/src/index.ts"],
      "@livefolio/sdk/interfaces": ["./node_modules/@livefolio/sdk/src/interfaces/index.ts"],
      "@livefolio/sdk/strategy": ["./node_modules/@livefolio/sdk/src/strategy/index.ts"],
      "@livefolio/sdk/features": ["./node_modules/@livefolio/sdk/src/features/index.ts"],
      "@livefolio/sdk/tactical": ["./node_modules/@livefolio/sdk/src/tactical/index.ts"],
      "@livefolio/sdk/reference": ["./node_modules/@livefolio/sdk/src/reference/index.ts"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write `fred/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@livefolio/sdk'],
});
```

- [ ] **Step 5: Write `fred/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const sdkSrc = fileURLToPath(new URL('./node_modules/@livefolio/sdk/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@livefolio\/sdk$/, replacement: `${sdkSrc}/index.ts` },
      { find: /^@livefolio\/sdk\/(.*)$/, replacement: `${sdkSrc}/$1/index.ts` },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
  },
});
```

- [ ] **Step 6: Write `fred/eslint.config.js`**

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.config.js', '*.config.ts'],
  },
];
```

- [ ] **Step 7: Write `fred/.prettierrc`**

```json
{
    "printWidth": 120,
    "singleQuote": true
}
```

- [ ] **Step 8: Write `fred/.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 9: Copy the LICENSE from the SDK**

```bash
cp /Users/raksi/Documents/Personal/livefolio-2/sdk/LICENSE /Users/raksi/Documents/Personal/livefolio-2/fred/LICENSE
```

- [ ] **Step 10: Write `fred/README.md`**

```markdown
# @livefolio/fred

FRED (St. Louis Fed) macro time series adapter for [`@livefolio/sdk`](https://github.com/livefolio/sdk) v0.4.

A `DataFeed` implementation that wraps FRED's `series/observations` REST endpoint. Pass-through: each FRED observation becomes a degenerate OHLCV bar (`open=high=low=close=value`, `volume=0`). Use it on its own for macro-only strategies, or compose with other feeds via `RoutingDataFeed`.

## Install

```bash
npm install @livefolio/fred @livefolio/sdk
```

## Usage

```ts
import { FredDataFeed } from '@livefolio/fred';
import type { Asset, DateRange } from '@livefolio/sdk';

const fred = new FredDataFeed({ apiKey: process.env.FRED_API_KEY! });

const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };
const range: DateRange = { from: new Date('2024-01-01'), to: new Date('2025-01-01') };

for await (const bar of fred.bars(dgs10, range, '1d')) {
  console.log(bar.t.toISOString(), bar.close);
}
```

## Composition with `@livefolio/yfinance`

```ts
import { RoutingDataFeed } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';
import { FredDataFeed } from '@livefolio/fred';

const feed = new RoutingDataFeed({
  equity: new YfinanceDataFeed(),
  macro: new FredDataFeed({ apiKey: process.env.FRED_API_KEY! }),
});
```

## Scope

- `bars()` only. No `fundamentals()`, no `events()`.
- `freq: '1d'` only — anything else throws.
- `kind: 'macro'` only — anything else throws.
- Pass-through cadence: monthly series like `CPIAUCSL` yield sparse monthly bars when fetched as `'1d'`. Aggregation is the consumer's responsibility.

## Configuration

Get a free API key from <https://fred.stlouisfed.org/docs/api/api_key.html>. The package never reads `FRED_API_KEY` from the environment automatically — pass it explicitly.

## License

MIT
```

- [ ] **Step 11: Write `fred/AGENTS.md`**

```markdown
# @livefolio/fred

## Purpose
FRED (St. Louis Fed) `DataFeed` adapter for `@livefolio/sdk` v0.4. Wraps FRED's `series/observations` REST endpoint to implement the SDK's `DataFeed.bars` interface — narrows `Asset` to `MacroAsset`, calls FRED with the asset's `id` as the `series_id`, drops missing-value rows, and yields each observation as a degenerate OHLCV bar (`open=high=low=close=value`, `volume=0`). UTC-midnight timestamps.

The package is intentionally thin: pass-through cadence (monthly series stay monthly), no `fundamentals` / `events`, no upsampling. Designed to plug into `RoutingDataFeed`'s `macro` slot alongside `@livefolio/yfinance`.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Project manifest — `@livefolio/fred`, ES module, Node >=20 |
| `tsconfig.json` | TypeScript strict mode, ES2022 target, bundler module resolution, `noUncheckedIndexedAccess` |
| `tsup.config.ts` | tsup bundler configuration, `@livefolio/sdk` marked external |
| `vitest.config.ts` | Vitest test runner configuration |
| `eslint.config.js` | ESLint flat config with typescript-eslint and Prettier |
| `.prettierrc` | Prettier formatting rules (matches the SDK byte-for-byte) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | All TypeScript source code — adapter implementation and co-located tests |
| `docs/` | Design specs and implementation plans |

## For AI Agents

### Working In This Directory
- This is an ES module project (`"type": "module"`) — extensionless imports, bundled with tsup
- The SDK is consumed as a peer dependency; in this checkout it links to `../sdk` via `file:../sdk`
- `@livefolio/sdk` is marked `external` in `tsup.config.ts` so it is never inlined into `dist/`
- Native `fetch` (Node >=20) is the HTTP client — no `axios`, no `node-fetch`

### Testing Requirements
- Run `npm test` to execute all Vitest tests
- Tests use Vitest's `vi.fn()` and a `vi.spyOn(globalThis, 'fetch')` pattern for HTTP mocks — no real network connection
- A single integration test (`src/integration.test.ts`) hits the live FRED API and is gated on `process.env.FRED_API_KEY`; skipped without the key

### Common Patterns
- **Single class export**: `FredDataFeed` is the only consumer-facing surface
- **Injected fetcher seam**: the constructor accepts a `fetcher` option so tests can swap the live FRED client for a mocked one
- **Range-aware in-memory cache**: deduplicates bar fetches across overlapping ranges within a backtest
- **Pass-through cadence**: monthly/weekly/quarterly series surface at their native publish rate; the adapter never resamples

## Dependencies

### External (runtime)
- None — uses native `fetch` (Node >=20)

### Peer
- `@livefolio/sdk` — Provides `Asset`, `MacroAsset`, `Bar`, `DateRange`, `Frequency`, and the `DataFeed` interface

### Dev
- `tsup` — Bundler
- `vitest` — Test runner
- `typescript` — Compiler
- `eslint` + `typescript-eslint` — Linting
- `prettier` — Formatting
```

- [ ] **Step 12: Write `fred/CLAUDE.md`**

```markdown
@AGENTS.md
```

- [ ] **Step 13: Copy the spec into the new repo**

```bash
cp /Users/raksi/Documents/Personal/livefolio-2/sdk/docs/specs/2026-05-03-fred-adapter-design.md /Users/raksi/Documents/Personal/livefolio-2/fred/docs/specs/2026-05-03-fred-adapter-design.md
```

- [ ] **Step 14: Write `fred/docs/AGENTS.md`** (one short file)

```markdown
# fred/docs

## Purpose
Design specs and implementation plans for `@livefolio/fred`.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `specs/` | Design documents (one per feature). Filenames are `YYYY-MM-DD-<topic>-design.md`. |
| `plans/` | Implementation plans derived from specs. Filenames are `YYYY-MM-DD-<topic>.md`. |
```

- [ ] **Step 15: Run `npm install`**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm install
```

Expected: install completes; `node_modules/@livefolio/sdk` is a symlink (or hard-linked tree) pointing to `../sdk/`. If install fails because the SDK is not yet built — that's fine, this package consumes the SDK from source via the vitest/tsconfig path aliases, not from the SDK's `dist/`.

- [ ] **Step 16: Verify the empty toolchain works**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test && npm run lint
```

Expected: vitest reports zero tests (passes via `passWithNoTests`), eslint reports zero errors (no source yet).

- [ ] **Step 17: Initialize git and commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && git init -b main && git add . && git commit -m "chore: scaffold @livefolio/fred package

Mirrors @livefolio/yfinance template. Empty src/ ready for implementation.
Spec: docs/specs/2026-05-03-fred-adapter-design.md"
```

---

### Task 2: Implement `assetToFredSeriesId` (TDD)

**Goal:** A pure function that narrows `Asset` to `MacroAsset` and returns the FRED series ID (`asset.id`). Throws on non-macro kinds.

**Files:**
- Create: `fred/src/asset.ts`
- Create: `fred/src/asset.test.ts`

**Acceptance Criteria:**
- [ ] `assetToFredSeriesId({ kind: 'macro', id: 'DGS10', symbol: '10Y' })` returns `'DGS10'`
- [ ] `assetToFredSeriesId({ kind: 'equity', ... })` throws `Error` mentioning the kind and id
- [ ] All 3 tests pass
- [ ] `npm run lint` clean

**Verify:**
```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/asset && npm run lint
```

**Steps:**

- [ ] **Step 1: Write `src/asset.test.ts` (red)**

```ts
import { describe, it, expect } from 'vitest';
import type { Asset } from '@livefolio/sdk';
import { assetToFredSeriesId } from './asset';

describe('assetToFredSeriesId', () => {
  it('returns asset.id for a macro asset', () => {
    const asset: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };
    expect(assetToFredSeriesId(asset)).toBe('DGS10');
  });

  it('throws for an equity asset, mentioning kind and id', () => {
    const asset: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
    expect(() => assetToFredSeriesId(asset)).toThrow(/kind="equity"/);
    expect(() => assetToFredSeriesId(asset)).toThrow(/id="AAPL"/);
  });

  it('throws for an unknown kind', () => {
    const asset = { kind: 'crypto', id: 'btc', symbol: 'BTC-USD' } as unknown as Asset;
    expect(() => assetToFredSeriesId(asset)).toThrow(/kind="crypto"/);
  });
});
```

- [ ] **Step 2: Run tests — confirm fail with module-not-found**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/asset
```

Expected: failure resolving `./asset`.

- [ ] **Step 3: Write `src/asset.ts` (green)**

```ts
import type { Asset } from '@livefolio/sdk';

/**
 * Resolves a v0.4 `Asset` to the FRED series ID for the `series/observations`
 * endpoint. Currently only `MacroAsset` is supported — the FRED API has no
 * concept of equities, options, futures, etc.
 *
 * Pure. No I/O.
 */
export function assetToFredSeriesId(asset: Asset): string {
  switch (asset.kind) {
    case 'macro':
      return asset.id;
    default: {
      const kind = (asset as { kind: string }).kind;
      const id = (asset as { id: string }).id;
      throw new Error(`assetToFredSeriesId: unsupported asset kind="${kind}" id="${id}"`);
    }
  }
}
```

- [ ] **Step 4: Run tests — confirm passing**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/asset
```

Expected: 3 passing.

- [ ] **Step 5: Lint**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm run lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && git add src/asset.ts src/asset.test.ts && git commit -m "feat: add assetToFredSeriesId

Narrows Asset to MacroAsset and returns asset.id for FRED's series_id parameter.
Throws on non-macro kinds with kind+id in the message."
```

---

### Task 3: Add `BarCache` (port from yfinance)

**Goal:** Range-aware in-memory bar cache, keyed by `(seriesId, freq)`. Verbatim port from `@livefolio/yfinance` so the FRED adapter inherits the same dedup behavior — backtests fetch each series at most once per range.

**Files:**
- Create: `fred/src/cache.ts`
- Create: `fred/src/cache.test.ts`

**Acceptance Criteria:**
- [ ] `BarCache` exposes `get(symbol, range, freq)` and `set(symbol, freq, range, bars)` with the same semantics as `@livefolio/yfinance` (range covers requested → return slice; not covering → undefined; strict-superset set → widen; partial overlap → throw)
- [ ] All 7 tests pass
- [ ] `npm run lint` clean

**Verify:**
```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/cache && npm run lint
```

**Steps:**

- [ ] **Step 1: Write `src/cache.test.ts` (red)**

```ts
import { describe, it, expect } from 'vitest';
import type { Bar } from '@livefolio/sdk';
import { BarCache } from './cache';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function bar(date: string, close: number): Bar {
  return { t: utc(date), open: close, high: close, low: close, close, volume: 0 };
}

const SERIES = [
  bar('2024-04-01', 4.0),
  bar('2024-04-02', 4.05),
  bar('2024-04-03', 4.1),
  bar('2024-04-04', 4.12),
  bar('2024-04-05', 4.08),
];

describe('BarCache', () => {
  it('empty cache miss returns undefined', () => {
    const c = new BarCache();
    expect(c.get('DGS10', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d')).toBeUndefined();
  });

  it('exact-range hit returns the full slice', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('DGS10', '1d', range, SERIES);
    const out = c.get('DGS10', range, '1d');
    expect(out).toHaveLength(5);
    expect(out?.[0]?.t.toISOString()).toBe('2024-04-01T00:00:00.000Z');
    expect(out?.[4]?.t.toISOString()).toBe('2024-04-05T00:00:00.000Z');
  });

  it('sub-range hit returns the bars within the requested range, inclusive both ends', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-01'), to: utc('2024-04-05') }, SERIES);
    const out = c.get('DGS10', { from: utc('2024-04-02'), to: utc('2024-04-04') }, '1d');
    expect(out).toHaveLength(3);
    expect(out?.[0]?.t.toISOString()).toBe('2024-04-02T00:00:00.000Z');
    expect(out?.[2]?.t.toISOString()).toBe('2024-04-04T00:00:00.000Z');
  });

  it('super-range miss: requested range exceeds cached range', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SERIES.slice(1, 4));
    expect(c.get('DGS10', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d')).toBeUndefined();
  });

  it('isolates cache entries per series id', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('DGS10', '1d', range, SERIES);
    expect(c.get('DGS2', range, '1d')).toBeUndefined();
    expect(c.get('DGS10', range, '1d')).toHaveLength(5);
  });

  it('isolates cache entries per frequency', () => {
    const c = new BarCache();
    const range = { from: utc('2024-04-01'), to: utc('2024-04-05') };
    c.set('DGS10', '1d', range, SERIES);
    expect(c.get('DGS10', range, '1h')).toBeUndefined();
  });

  it('set: strict-superset widens the cached range', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SERIES.slice(1, 4));
    c.set('DGS10', '1d', { from: utc('2024-04-01'), to: utc('2024-04-05') }, SERIES);
    expect(c.get('DGS10', { from: utc('2024-04-01'), to: utc('2024-04-05') }, '1d')).toHaveLength(5);
  });

  it('set: throws on partial overlap (YAGNI per plan)', () => {
    const c = new BarCache();
    c.set('DGS10', '1d', { from: utc('2024-04-02'), to: utc('2024-04-04') }, SERIES.slice(1, 4));
    expect(() =>
      c.set('DGS10', '1d', { from: utc('2024-04-03'), to: utc('2024-04-05') }, SERIES.slice(2, 5)),
    ).toThrow(/partial overlap/i);
  });
});
```

- [ ] **Step 2: Run tests — confirm fail**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/cache
```

Expected: failure resolving `./cache`.

- [ ] **Step 3: Write `src/cache.ts` (green) — copy the yfinance implementation verbatim**

```ts
import type { Bar, DateRange, Frequency } from '@livefolio/sdk';

type Entry = { range: DateRange; bars: Bar[] };

/**
 * Range-aware in-memory bar cache, keyed by `(seriesId, freq)`.
 *
 * `get` returns `undefined` if the cached range doesn't cover the requested
 * range; otherwise it returns the bars sliced to `[range.from, range.to]`
 * inclusive on both ends.
 *
 * `set` widens the cached range when the new range is a strict superset of the
 * old; it **throws** on partial overlap (YAGNI per plan — the call pattern
 * always fetches `[earliest, latest]` once per series per backtest).
 *
 * No expiry, no eviction. Lifetime tied to the owning `FredDataFeed`.
 */
export class BarCache {
  private store = new Map<string, Entry>();

  private key(symbol: string, freq: Frequency): string {
    return `${symbol}:${freq}`;
  }

  get(symbol: string, range: DateRange, freq: Frequency): Bar[] | undefined {
    const entry = this.store.get(this.key(symbol, freq));
    if (!entry) return undefined;
    if (entry.range.from.getTime() > range.from.getTime()) return undefined;
    if (entry.range.to.getTime() < range.to.getTime()) return undefined;
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    return entry.bars.filter((b) => {
      const t = b.t.getTime();
      return t >= fromMs && t <= toMs;
    });
  }

  set(symbol: string, freq: Frequency, range: DateRange, bars: Bar[]): void {
    const k = this.key(symbol, freq);
    const prior = this.store.get(k);
    if (!prior) {
      this.store.set(k, { range: { from: range.from, to: range.to }, bars: [...bars] });
      return;
    }

    const priorFrom = prior.range.from.getTime();
    const priorTo = prior.range.to.getTime();
    const newFrom = range.from.getTime();
    const newTo = range.to.getTime();

    // New strictly contains prior → widen.
    if (newFrom <= priorFrom && newTo >= priorTo) {
      this.store.set(k, { range: { from: range.from, to: range.to }, bars: [...bars] });
      return;
    }

    // New is contained by prior → no-op (prior already covers it).
    if (newFrom >= priorFrom && newTo <= priorTo) {
      return;
    }

    throw new Error(
      `BarCache.set: partial overlap on ${k} — ` +
        `prior=[${prior.range.from.toISOString()},${prior.range.to.toISOString()}], ` +
        `new=[${range.from.toISOString()},${range.to.toISOString()}]. ` +
        'Range merging is YAGNI in v0.1; fetch the full union range instead.',
    );
  }
}
```

- [ ] **Step 4: Run tests — confirm 7 passing**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/cache
```

- [ ] **Step 5: Lint**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm run lint
```

- [ ] **Step 6: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && git add src/cache.ts src/cache.test.ts && git commit -m "feat: add BarCache (port from @livefolio/yfinance)

Range-aware in-memory cache, keyed by (seriesId, freq). Same semantics as
yfinance: superset widens, partial overlap throws."
```

---

### Task 4: Implement `fetchFredObservations` (TDD)

**Goal:** Pure HTTP transport. Builds the FRED URL, calls `fetch`, validates the response, drops missing-value rows, maps each observation to a `Bar`, returns the array.

**Files:**
- Create: `fred/src/fred-client.ts`
- Create: `fred/src/fred-client.test.ts`

**Acceptance Criteria:**
- [ ] `fetchFredObservations('DGS10', range, { apiKey })` returns `Bar[]` with one bar per non-`'.'` observation
- [ ] Each bar has `open=high=low=close=parseFloat(value)`, `volume=0`, `t = midnight UTC of date`
- [ ] FRED URL is built with `series_id`, `api_key`, `file_type=json`, `observation_start=YYYY-MM-DD` (= `range.from`), `observation_end=YYYY-MM-DD` (= `range.to - 1 day`, to honor the SDK's exclusive `to`)
- [ ] HTTP non-2xx throws with status + body in the message
- [ ] FRED 200 with `error_message` throws
- [ ] `npm run lint` clean

**Verify:**
```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/fred-client && npm run lint
```

**Steps:**

- [ ] **Step 1: Write `src/fred-client.test.ts` (red)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DateRange } from '@livefolio/sdk';
import { fetchFredObservations } from './fred-client';

const range: DateRange = { from: new Date('2024-04-01T00:00:00Z'), to: new Date('2024-04-06T00:00:00Z') };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchFredObservations', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('builds the URL with the expected query params', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ observations: [] }));
    await fetchFredObservations('DGS10', range, { apiKey: 'TEST_KEY' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = new URL((fetchSpy.mock.calls[0]![0] as URL | string).toString());
    expect(url.origin + url.pathname).toBe('https://api.stlouisfed.org/fred/series/observations');
    expect(url.searchParams.get('series_id')).toBe('DGS10');
    expect(url.searchParams.get('api_key')).toBe('TEST_KEY');
    expect(url.searchParams.get('file_type')).toBe('json');
    expect(url.searchParams.get('observation_start')).toBe('2024-04-01');
    // range.to is exclusive (2024-04-06), so observation_end is 2024-04-05.
    expect(url.searchParams.get('observation_end')).toBe('2024-04-05');
  });

  it('maps observations to bars (open=high=low=close=value, volume=0)', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        observations: [
          { date: '2024-04-01', value: '4.21' },
          { date: '2024-04-02', value: '4.18' },
        ],
      }),
    );
    const bars = await fetchFredObservations('DGS10', range, { apiKey: 'k' });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      t: new Date('2024-04-01T00:00:00Z'),
      open: 4.21,
      high: 4.21,
      low: 4.21,
      close: 4.21,
      volume: 0,
    });
    expect(bars[1]?.close).toBe(4.18);
  });

  it("drops observations with FRED's missing-value sentinel '.'", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        observations: [
          { date: '2024-04-01', value: '4.21' },
          { date: '2024-04-02', value: '.' },
          { date: '2024-04-03', value: '4.18' },
        ],
      }),
    );
    const bars = await fetchFredObservations('DGS10', range, { apiKey: 'k' });
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.t.toISOString())).toEqual(['2024-04-01T00:00:00.000Z', '2024-04-03T00:00:00.000Z']);
  });

  it('throws on HTTP non-2xx with status and body in the message', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Bad Request: invalid api_key', { status: 400 }));
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'bad' })).rejects.toThrow(/400/);
    fetchSpy.mockResolvedValueOnce(new Response('Bad Request: invalid api_key', { status: 400 }));
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'bad' })).rejects.toThrow(/invalid api_key/);
  });

  it("throws on FRED 200 with error_message", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error_code: 400, error_message: 'Variable api_key is not registered.' }));
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'k' })).rejects.toThrow(
      /Variable api_key is not registered/,
    );
  });

  it('propagates network errors without wrapping', async () => {
    const networkErr = new TypeError('fetch failed');
    fetchSpy.mockRejectedValueOnce(networkErr);
    await expect(fetchFredObservations('DGS10', range, { apiKey: 'k' })).rejects.toBe(networkErr);
  });
});
```

- [ ] **Step 2: Run tests — confirm fail**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/fred-client
```

Expected: module-not-found.

- [ ] **Step 3: Write `src/fred-client.ts` (green)**

```ts
import type { Bar, DateRange } from '@livefolio/sdk';

const FRED_OBSERVATIONS_URL = 'https://api.stlouisfed.org/fred/series/observations';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type FredObservation = {
  date: string;
  value: string;
};

type FredObservationsResponse = {
  observations?: FredObservation[];
  error_code?: number;
  error_message?: string;
};

/**
 * Format a `Date` as `YYYY-MM-DD` in UTC. FRED's `observation_start` and
 * `observation_end` are date-only and inclusive on both ends.
 */
function toFredDate(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Fetches FRED observations for `seriesId` over `range`, returning each
 * non-missing observation as a degenerate OHLCV `Bar`.
 *
 * `range` is half-open `[from, to)`; FRED's `observation_end` is inclusive,
 * so we send `to - 1 day`.
 *
 * Throws on:
 * - HTTP non-2xx (message includes status + body)
 * - FRED 200 with `error_message` (message echoes FRED's error)
 *
 * Network rejections from `fetch` propagate unwrapped.
 */
export async function fetchFredObservations(
  seriesId: string,
  range: DateRange,
  opts: { apiKey: string },
): Promise<Bar[]> {
  const url = new URL(FRED_OBSERVATIONS_URL);
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', opts.apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('observation_start', toFredDate(range.from));
  url.searchParams.set('observation_end', toFredDate(new Date(range.to.getTime() - ONE_DAY_MS)));

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`fetchFredObservations: FRED returned HTTP ${response.status} for series_id="${seriesId}": ${body}`);
  }

  const json = (await response.json()) as FredObservationsResponse;

  if (json.error_message !== undefined) {
    throw new Error(`fetchFredObservations: FRED error for series_id="${seriesId}": ${json.error_message}`);
  }

  const observations = json.observations ?? [];
  const bars: Bar[] = [];
  for (const obs of observations) {
    if (obs.value === '.') continue;
    const value = Number.parseFloat(obs.value);
    bars.push({
      t: new Date(`${obs.date}T00:00:00Z`),
      open: value,
      high: value,
      low: value,
      close: value,
      volume: 0,
    });
  }
  return bars;
}

export type FetchFredObservationsOptions = { apiKey: string };
```

- [ ] **Step 4: Run tests — confirm 6 passing**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/fred-client
```

- [ ] **Step 5: Lint**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm run lint
```

- [ ] **Step 6: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && git add src/fred-client.ts src/fred-client.test.ts && git commit -m "feat: add fetchFredObservations HTTP client

Calls FRED's series/observations endpoint, drops missing-value rows,
maps each observation to a degenerate OHLCV bar. Native fetch only."
```

---

### Task 5: Implement `FredDataFeed` (TDD)

**Goal:** The public `DataFeed` class. Composition of asset normalization, bar cache, inflight dedup, and the FRED client. Throws on `freq !== '1d'`. Async generator `bars()` so resolution and freq-validation throws surface as iterable rejections (consistent with `RoutingDataFeed`).

**Files:**
- Create: `fred/src/fred-data-feed.ts`
- Create: `fred/src/fred-data-feed.test.ts`

**Acceptance Criteria:**
- [ ] `new FredDataFeed({ apiKey, fetcher? })` constructs
- [ ] `bars(macroAsset, range, '1d')` invokes the fetcher with `(seriesId, range, { apiKey })`
- [ ] Second `bars()` call for the same `(seriesId, freq, range)` reads from cache (fetcher called once)
- [ ] Concurrent `bars()` calls for the same `(seriesId, freq)` share a single in-flight fetch
- [ ] `bars(equityAsset, ...)` rejects (asset normalization throws)
- [ ] `bars(macroAsset, range, '1h')` rejects with a freq error message
- [ ] `'fundamentals' in feed === false`
- [ ] `'events' in feed === false`
- [ ] `npm run lint` clean

**Verify:**
```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/fred-data-feed && npm run lint
```

**Steps:**

- [ ] **Step 1: Write `src/fred-data-feed.test.ts` (red)**

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Asset, Bar, DateRange } from '@livefolio/sdk';
import { FredDataFeed, type FredFetcher } from './fred-data-feed';

const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y' };
const aapl: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
const range: DateRange = { from: new Date('2024-04-01T00:00:00Z'), to: new Date('2024-04-06T00:00:00Z') };

function bar(date: string, value: number): Bar {
  return {
    t: new Date(`${date}T00:00:00Z`),
    open: value,
    high: value,
    low: value,
    close: value,
    volume: 0,
  };
}

const FIXTURE: Bar[] = [bar('2024-04-01', 4.21), bar('2024-04-02', 4.18), bar('2024-04-03', 4.15)];

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('FredDataFeed', () => {
  it('routes bars(macro, range, "1d") through the injected fetcher', async () => {
    const fetcher: FredFetcher = vi.fn(async () => [...FIXTURE]);
    const feed = new FredDataFeed({ apiKey: 'k', fetcher });

    const bars = await drain(feed.bars(dgs10, range, '1d'));

    expect(bars).toHaveLength(3);
    expect(bars[0]?.close).toBe(4.21);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('DGS10', range, { apiKey: 'k' });
  });

  it('serves the second bars call from cache (fetcher called once)', async () => {
    const fetcher: FredFetcher = vi.fn(async () => [...FIXTURE]);
    const feed = new FredDataFeed({ apiKey: 'k', fetcher });

    await drain(feed.bars(dgs10, range, '1d'));
    await drain(feed.bars(dgs10, range, '1d'));

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent calls into a single in-flight fetch', async () => {
    let resolve!: (bars: Bar[]) => void;
    const fetcher: FredFetcher = vi.fn(
      () =>
        new Promise<Bar[]>((r) => {
          resolve = r;
        }),
    );
    const feed = new FredDataFeed({ apiKey: 'k', fetcher });

    const p1 = drain(feed.bars(dgs10, range, '1d'));
    const p2 = drain(feed.bars(dgs10, range, '1d'));

    // Both calls created before the fetcher resolves.
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve([...FIXTURE]);

    const [b1, b2] = await Promise.all([p1, p2]);
    expect(b1).toHaveLength(3);
    expect(b2).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throws RoutingDataFeed-style on non-macro assets', async () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    await expect(drain(feed.bars(aapl, range, '1d'))).rejects.toThrow(/kind="equity"/);
  });

  it('throws on freq other than "1d"', async () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    await expect(drain(feed.bars(dgs10, range, '1h'))).rejects.toThrow(/freq/);
    await expect(drain(feed.bars(dgs10, range, '1h'))).rejects.toThrow(/1h/);
  });

  it('does not implement fundamentals', () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    expect('fundamentals' in feed).toBe(false);
  });

  it('does not implement events', () => {
    const feed = new FredDataFeed({ apiKey: 'k', fetcher: vi.fn() });
    expect('events' in feed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm fail**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/fred-data-feed
```

Expected: module-not-found.

- [ ] **Step 3: Write `src/fred-data-feed.ts` (green)**

```ts
import type { Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';
import { assetToFredSeriesId } from './asset';
import { fetchFredObservations } from './fred-client';
import { BarCache } from './cache';

/** Function form used to fetch raw bars. Tests inject a mock; production uses {@link fetchFredObservations}. */
export type FredFetcher = (
  seriesId: string,
  range: DateRange,
  opts: { apiKey: string },
) => Promise<Bar[]>;

export type FredDataFeedOptions = {
  /** Required. FRED API key. */
  apiKey: string;
  /** Override the live fetcher. Tests inject a stub to stay offline. */
  fetcher?: FredFetcher;
};

const defaultFetcher: FredFetcher = (seriesId, range, opts) => fetchFredObservations(seriesId, range, opts);

/**
 * Implements `@livefolio/sdk` v0.4's `DataFeed.bars` over FRED's
 * `series/observations` endpoint.
 *
 * Composition: `assetToFredSeriesId` → `BarCache` → `fetchFredObservations`. A
 * per-instance `BarCache` deduplicates fetches inside a backtest; an in-flight
 * map further dedupes concurrent calls for the same `(seriesId, freq)`.
 *
 * `fundamentals` and `events` are intentionally *not* defined on the instance
 * — the SDK's interface marks them optional, and consumers feature-detect via
 * `'fundamentals' in feed`.
 *
 * Only `freq: '1d'` is accepted; FRED has no concept of intraday observations.
 */
export class FredDataFeed implements DataFeed {
  private readonly apiKey: string;
  private readonly fetcher: FredFetcher;
  private readonly cache = new BarCache();
  private readonly inflight = new Map<string, Promise<Bar[]>>();

  constructor(opts: FredDataFeedOptions) {
    this.apiKey = opts.apiKey;
    this.fetcher = opts.fetcher ?? defaultFetcher;
  }

  // Async generator (rather than plain delegation) so the freq/asset-kind
  // checks throw lazily on first next() — surfacing as iterable rejections
  // rather than synchronous throws at call time, consistent with
  // RoutingDataFeed.bars.
  async *bars(asset: Asset, range: DateRange, freq: Frequency): AsyncGenerator<Bar> {
    if (freq !== '1d') {
      throw new Error(`FredDataFeed.bars: unsupported freq="${freq}". FRED supports daily ('1d') only.`);
    }

    const seriesId = assetToFredSeriesId(asset);

    const cached = this.cache.get(seriesId, range, freq);
    if (cached !== undefined) {
      for (const b of cached) yield b;
      return;
    }

    const inflightKey = `${seriesId}:${freq}`;
    let pending = this.inflight.get(inflightKey);
    if (!pending) {
      pending = (async () => {
        try {
          const bars = await this.fetcher(seriesId, range, { apiKey: this.apiKey });
          this.cache.set(seriesId, freq, range, bars);
          return bars;
        } finally {
          this.inflight.delete(inflightKey);
        }
      })();
      this.inflight.set(inflightKey, pending);
    }

    await pending;

    // After the fetch, the cache should serve the requested range. If a
    // concurrent fetch was for a different range, fall back to the resolved
    // bars filtered to this caller's range.
    const post = this.cache.get(seriesId, range, freq);
    if (post !== undefined) {
      for (const b of post) yield b;
      return;
    }

    const bars = await pending;
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    for (const b of bars) {
      const t = b.t.getTime();
      if (t >= fromMs && t <= toMs) yield b;
    }
  }
}
```

- [ ] **Step 4: Run tests — confirm 7 passing**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm test -- src/fred-data-feed
```

- [ ] **Step 5: Lint**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm run lint
```

- [ ] **Step 6: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && git add src/fred-data-feed.ts src/fred-data-feed.test.ts && git commit -m "feat: add FredDataFeed class

Composes assetToFredSeriesId + BarCache + fetcher with per-instance cache
and concurrent-fetch dedup. Throws on freq != '1d' and non-macro kinds."
```

---

### Task 6: Wire barrel + integration test + final verification

**Goal:** Public `index.ts` barrel, optional integration test gated on `FRED_API_KEY`, full pipeline verification, build the package once.

**Files:**
- Create: `fred/src/index.ts`
- Create: `fred/src/integration.test.ts`

**Acceptance Criteria:**
- [ ] `import { FredDataFeed, FredDataFeedOptions, FredFetcher, fetchFredObservations, assetToFredSeriesId } from '@livefolio/fred'` resolves
- [ ] `npm run build` succeeds; `dist/index.d.ts` exports `FredDataFeed`
- [ ] Integration test skips when `FRED_API_KEY` is not set
- [ ] `npm run lint && npm test && npm run build` all green

**Verify:**
```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm run lint && npm test && npm run build && grep -c FredDataFeed dist/index.d.ts
```
Expected: ≥ 2.

**Steps:**

- [ ] **Step 1: Write `src/index.ts`**

```ts
export { FredDataFeed } from './fred-data-feed';
export type { FredDataFeedOptions, FredFetcher } from './fred-data-feed';
export { fetchFredObservations } from './fred-client';
export type { FetchFredObservationsOptions } from './fred-client';
export { assetToFredSeriesId } from './asset';
```

- [ ] **Step 2: Write `src/integration.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { Asset, Bar, DateRange } from '@livefolio/sdk';
import { FredDataFeed } from './fred-data-feed';

const apiKey = process.env.FRED_API_KEY;

const describeIfKey = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip;

describeIfKey('FredDataFeed integration (live FRED)', () => {
  it('fetches DGS10 for a known week and returns at least one bar', async () => {
    const feed = new FredDataFeed({ apiKey: apiKey! });
    const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };
    const range: DateRange = {
      from: new Date('2024-04-01T00:00:00Z'),
      to: new Date('2024-04-08T00:00:00Z'),
    };
    const bars: Bar[] = [];
    for await (const b of feed.bars(dgs10, range, '1d')) {
      bars.push(b);
    }
    expect(bars.length).toBeGreaterThan(0);
    expect(typeof bars[0]?.close).toBe('number');
    expect(Number.isFinite(bars[0]?.close)).toBe(true);
    // DGS10 publishes on weekdays — within a Mon–Sun window we expect 5 bars,
    // but FRED occasionally has holiday gaps; assert ≥ 3 to be conservative.
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 3: Run the verification pipeline**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && npm run lint && npm test && npm run build
```

Expected: all green. The integration test reports `(skipped)` when `FRED_API_KEY` is unset.

- [ ] **Step 4: Sanity check the bundled types**

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && grep -c FredDataFeed dist/index.d.ts
```

Expected: ≥ 2.

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/fred && git add src/index.ts src/integration.test.ts && git commit -m "feat: wire public barrel and add gated integration test

Public surface: FredDataFeed, FredDataFeedOptions, FredFetcher,
fetchFredObservations, assetToFredSeriesId. Integration test skips
when FRED_API_KEY is unset."
```

- [ ] **Step 6 (optional): Run the integration test against a real key**

If you have a FRED API key locally:

```
cd /Users/raksi/Documents/Personal/livefolio-2/fred && FRED_API_KEY=<key> npm test -- src/integration.test.ts
```

Expected: 1 passing.

---

## Out of scope for this plan

- Browser build (`@livefolio/fred-browser`).
- `fundamentals()` for FRED metadata endpoints.
- ALFRED real-time vintages (`realtime_start`/`realtime_end` filtering).
- A docs-site recipe for Yahoo + FRED composition.
- Publishing to npm (manual `npm publish` step is out of scope).
- Removing the SDK-side copy of the spec at `sdk/docs/specs/2026-05-03-fred-adapter-design.md`. The fred copy becomes canonical; the SDK copy can be deleted in a separate cleanup pass.
