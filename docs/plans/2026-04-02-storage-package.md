# @livefolio/storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@livefolio/storage@0.0.1` — a Supabase implementation of the SDK's `StorageProvider` interface, living at `livefolio-2/storage/`.

**Architecture:** Flat module structure with one file per `StorageProvider` namespace. A single factory function (`createSupabaseStorage`) composes namespace objects. Each namespace module translates SDK domain calls into Supabase PostgREST queries. A shared `resolveTradingDayIds` helper bridges the date-to-`trading_day_id` gap for write operations. Reads use PostgREST joins. Bundled with tsup, extensionless imports.

**Tech Stack:** TypeScript, tsup, Vitest, @supabase/supabase-js (peer), @livefolio/sdk (peer)

**Spec:** `sdk/docs/specs/2026-04-02-storage-package-design.md`

---

### Task 1: Scaffold Package

**Files:**
- Create: `storage/package.json`
- Create: `storage/tsconfig.json`
- Create: `storage/tsup.config.ts`
- Create: `storage/vitest.config.ts`
- Create: `storage/eslint.config.js`
- Create: `storage/.prettierrc`
- Create: `storage/.gitignore`
- Create: `storage/src/index.ts` (empty placeholder)

- [ ] **Step 1: Create `storage/package.json`**

```json
{
  "name": "@livefolio/storage",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsup",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write 'src/**/*.ts'",
    "format:check": "prettier --check 'src/**/*.ts'",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.ts": [
      "eslint --fix",
      "prettier --write"
    ]
  },
  "peerDependencies": {
    "@livefolio/sdk": "^0.0.1",
    "@supabase/supabase-js": "^2"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create `storage/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create `storage/tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Create `storage/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({});
```

- [ ] **Step 5: Create `storage/eslint.config.js`**

```javascript
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
    ignores: ['dist/', 'node_modules/', '*.config.js'],
  },
];
```

- [ ] **Step 6: Create `storage/.prettierrc`**

```json
{
    "printWidth": 120,
    "singleQuote": true
}
```

- [ ] **Step 7: Create `storage/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 8: Create empty `storage/src/index.ts`**

```typescript
// Placeholder — will be populated in Task 3
export {};
```

- [ ] **Step 9: Install dependencies**

```bash
cd storage && npm install --save-dev typescript tsup vitest @eslint/js eslint eslint-config-prettier eslint-plugin-prettier typescript-eslint prettier husky lint-staged @supabase/supabase-js @livefolio/sdk
```

Note: `@livefolio/sdk` and `@supabase/supabase-js` are peer deps but also installed as devDeps so TypeScript can resolve types during development. If `@livefolio/sdk` isn't published to npm, link it locally: `npm link ../sdk` or use a workspace protocol.

- [ ] **Step 10: Verify the build works**

```bash
cd storage && npm run build
```

Expected: `dist/index.js` and `dist/index.d.ts` created with no errors.

- [ ] **Step 11: Commit**

```bash
git add storage/
git commit -m "feat(storage): scaffold @livefolio/storage package"
```

---

### Task 2: Move Migrations and Generate Database Types

**Files:**
- Move: `sdk/supabase/migrations/*` → `storage/supabase/migrations/`
- Move: `sdk/supabase/config.toml` → `storage/supabase/config.toml`
- Create: `storage/src/database.types.ts` (generated)

- [ ] **Step 1: Copy migrations to storage package**

```bash
mkdir -p storage/supabase/migrations
cp sdk/supabase/migrations/*.sql storage/supabase/migrations/
```

Copy (not move) for now — the SDK may still reference them until the full provider refactor is complete.

- [ ] **Step 2: Copy Supabase config**

```bash
cp sdk/supabase/config.toml storage/supabase/config.toml
```

- [ ] **Step 3: Generate database types**

```bash
cd storage && npx supabase gen types typescript --local > src/database.types.ts
```

If local Supabase isn't running, generate from the remote project:

```bash
cd storage && npx supabase gen types typescript --project-id <project-id> > src/database.types.ts
```

- [ ] **Step 4: Verify the generated types compile**

```bash
cd storage && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add storage/supabase/ storage/src/database.types.ts
git commit -m "feat(storage): add migrations and generated database types"
```

---

### Task 3: Trading Day ID Resolver (Shared Helper)

**Files:**
- Create: `storage/src/trading-day-ids.ts`
- Create: `storage/src/trading-day-ids.test.ts`

This is the shared helper used by indicators, signals, and strategies `writeSeries` methods.

- [ ] **Step 1: Write the failing test**

Create `storage/src/trading-day-ids.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveTradingDayIds } from './trading-day-ids';

function mockSupabase(data: { id: number; date: string }[], error: { message: string } | null = null) {
  const gte = vi.fn().mockReturnValue({
    lte: vi.fn().mockResolvedValue({ data, error }),
  });
  const select = vi.fn().mockReturnValue({ gte });
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, gte } as { from: ReturnType<typeof vi.fn> } & Record<string, ReturnType<typeof vi.fn>>;
}

describe('resolveTradingDayIds', () => {
  it('resolves dates to trading day IDs using min/max range', async () => {
    const rows = [
      { id: 10, date: '2024-01-02' },
      { id: 11, date: '2024-01-03' },
      { id: 12, date: '2024-01-04' },
    ];
    const mock = mockSupabase(rows);
    const result = await resolveTradingDayIds(mock as unknown as SupabaseClient, [
      '2024-01-02',
      '2024-01-03',
      '2024-01-04',
    ]);

    expect(result).toEqual(
      new Map([
        ['2024-01-02', 10],
        ['2024-01-03', 11],
        ['2024-01-04', 12],
      ]),
    );
    expect(mock.from).toHaveBeenCalledWith('trading_days');
    expect(mock.select).toHaveBeenCalledWith('id, date');
    expect(mock.gte).toHaveBeenCalledWith('date', '2024-01-02');
  });

  it('throws on Supabase error', async () => {
    const mock = mockSupabase([], { message: 'connection failed' });
    await expect(
      resolveTradingDayIds(mock as unknown as SupabaseClient, ['2024-01-02']),
    ).rejects.toThrow('resolveTradingDayIds: connection failed');
  });

  it('returns empty map for empty dates array', async () => {
    const mock = mockSupabase([]);
    const result = await resolveTradingDayIds(mock as unknown as SupabaseClient, []);
    expect(result).toEqual(new Map());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/trading-day-ids.test.ts
```

Expected: FAIL — `trading-day-ids.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `storage/src/trading-day-ids.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveTradingDayIds(
  supabase: SupabaseClient,
  dates: string[],
): Promise<Map<string, number>> {
  if (dates.length === 0) return new Map();

  const min = dates.reduce((a, b) => (a < b ? a : b));
  const max = dates.reduce((a, b) => (a > b ? a : b));

  const { data, error } = await supabase
    .from('trading_days')
    .select('id, date')
    .gte('date', min)
    .lte('date', max);

  if (error) throw new Error(`resolveTradingDayIds: ${error.message}`);
  return new Map(data.map((row: { id: number; date: string }) => [row.date, row.id]));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/trading-day-ids.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/trading-day-ids.ts storage/src/trading-day-ids.test.ts
git commit -m "feat(storage): add resolveTradingDayIds helper"
```

---

### Task 4: Pagination Helper

**Files:**
- Create: `storage/src/paginate.ts`
- Create: `storage/src/paginate.test.ts`

Supabase caps results at 1000 rows. Series queries can exceed this. This helper paginates transparently.

- [ ] **Step 1: Write the failing test**

Create `storage/src/paginate.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { paginatedSelect } from './paginate';

describe('paginatedSelect', () => {
  it('returns all rows in a single page when under 1000', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const query = {
      range: vi.fn().mockResolvedValue({ data: rows, error: null, count: 50 }),
    };
    const builder = vi.fn().mockReturnValue(query);

    const result = await paginatedSelect(builder);
    expect(result).toHaveLength(50);
    expect(query.range).toHaveBeenCalledWith(0, 999);
  });

  it('paginates across multiple pages', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i }));
    const query = {
      range: vi
        .fn()
        .mockResolvedValueOnce({ data: page1, error: null, count: 1200 })
        .mockResolvedValueOnce({ data: page2, error: null, count: 1200 }),
    };
    const builder = vi.fn().mockReturnValue(query);

    const result = await paginatedSelect(builder);
    expect(result).toHaveLength(1200);
    expect(query.range).toHaveBeenCalledTimes(2);
    expect(query.range).toHaveBeenCalledWith(0, 999);
    expect(query.range).toHaveBeenCalledWith(1000, 1999);
  });

  it('throws on Supabase error', async () => {
    const query = {
      range: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' }, count: null }),
    };
    const builder = vi.fn().mockReturnValue(query);

    await expect(paginatedSelect(builder)).rejects.toThrow('fail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/paginate.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `storage/src/paginate.ts`:

```typescript
const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

interface RangeQuery<T> {
  range(from: number, to: number): Promise<PageResult<T>>;
}

/**
 * Paginates a Supabase select query that may return more than 1000 rows.
 * `buildQuery` is called for each page to produce a fresh query builder (with `.range()` appended).
 *
 * Usage:
 *   const rows = await paginatedSelect((q) =>
 *     supabase.from('table').select('*', { count: 'exact' }).eq('col', val)
 *   );
 */
export async function paginatedSelect<T>(
  buildQuery: () => RangeQuery<T>,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error, count } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (data) all.push(...data);

    const total = count ?? 0;
    offset += PAGE_SIZE;
    if (offset >= total || !data || data.length < PAGE_SIZE) break;
  }

  return all;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/paginate.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/paginate.ts storage/src/paginate.test.ts
git commit -m "feat(storage): add paginated select helper for >1000 row queries"
```

---

### Task 5: Tickers Namespace

**Files:**
- Create: `storage/src/tickers.ts`
- Create: `storage/src/tickers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `storage/src/tickers.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTickers } from './tickers';

function mockUpsert(data: { id: number } | null, error: { message: string } | null = null) {
  const single = vi.fn().mockResolvedValue({ data, error });
  const select = vi.fn().mockReturnValue({ single });
  const upsert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ upsert });
  return { from, upsert, select, single };
}

describe('createTickers', () => {
  it('upserts a ticker and returns its id', async () => {
    const mock = mockUpsert({ id: 42 });
    const tickers = createTickers(mock as unknown as SupabaseClient);

    const result = await tickers.upsert('SPY', 1);

    expect(result).toEqual({ id: 42 });
    expect(mock.from).toHaveBeenCalledWith('tickers');
    expect(mock.upsert).toHaveBeenCalledWith(
      { symbol: 'SPY', leverage: 1 },
      { onConflict: 'symbol,leverage' },
    );
    expect(mock.select).toHaveBeenCalledWith('id');
  });

  it('throws on Supabase error', async () => {
    const mock = mockUpsert(null, { message: 'duplicate key' });
    const tickers = createTickers(mock as unknown as SupabaseClient);

    await expect(tickers.upsert('SPY', 1)).rejects.toThrow('tickers.upsert: duplicate key');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/tickers.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `storage/src/tickers.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider } from '@livefolio/sdk';

export function createTickers(supabase: SupabaseClient): StorageProvider['tickers'] {
  return {
    async upsert(symbol, leverage) {
      const { data, error } = await supabase
        .from('tickers')
        .upsert({ symbol, leverage }, { onConflict: 'symbol,leverage' })
        .select('id')
        .single();
      if (error) throw new Error(`tickers.upsert: ${error.message}`);
      return { id: data.id };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/tickers.test.ts
```

Expected: All 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/tickers.ts storage/src/tickers.test.ts
git commit -m "feat(storage): implement tickers namespace"
```

---

### Task 6: Trading Days Namespace

**Files:**
- Create: `storage/src/trading-days.ts`
- Create: `storage/src/trading-days.test.ts`

- [ ] **Step 1: Write the failing test**

Create `storage/src/trading-days.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTradingDays } from './trading-days';

describe('createTradingDays', () => {
  describe('getRange', () => {
    it('returns all trading day dates within range', async () => {
      const rows = [{ date: '2024-01-02' }, { date: '2024-01-03' }, { date: '2024-01-04' }];
      const order = vi.fn().mockReturnValue({
        range: vi.fn().mockResolvedValue({ data: rows, error: null, count: 3 }),
      });
      const lte = vi.fn().mockReturnValue({ order });
      const gte = vi.fn().mockReturnValue({ lte });
      const select = vi.fn().mockReturnValue({ gte });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const tradingDays = createTradingDays(mock);
      const result = await tradingDays.getRange({ from: '2024-01-02', to: '2024-01-04' });

      expect(result).toEqual(['2024-01-02', '2024-01-03', '2024-01-04']);
      expect(from).toHaveBeenCalledWith('trading_days');
      expect(select).toHaveBeenCalledWith('date', { count: 'exact' });
    });

    it('returns all dates when no range specified', async () => {
      const rows = [{ date: '2024-01-02' }];
      const order = vi.fn().mockReturnValue({
        range: vi.fn().mockResolvedValue({ data: rows, error: null, count: 1 }),
      });
      const select = vi.fn().mockReturnValue({ order });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const tradingDays = createTradingDays(mock);
      const result = await tradingDays.getRange();

      expect(result).toEqual(['2024-01-02']);
    });
  });

  describe('getLatestClosed', () => {
    it('returns the most recent closed trading day date', async () => {
      const single = vi.fn().mockResolvedValue({ data: { date: '2024-06-14' }, error: null });
      const limit = vi.fn().mockReturnValue({ single });
      const lte = vi.fn().mockReturnValue({ limit });
      const order = vi.fn().mockReturnValue({ lte });
      const select = vi.fn().mockReturnValue({ order });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const tradingDays = createTradingDays(mock);
      const result = await tradingDays.getLatestClosed();

      expect(result).toBe('2024-06-14');
      expect(from).toHaveBeenCalledWith('trading_days');
    });

    it('returns null when no closed trading days exist', async () => {
      const single = vi.fn().mockResolvedValue({ data: null, error: null });
      const limit = vi.fn().mockReturnValue({ single });
      const lte = vi.fn().mockReturnValue({ limit });
      const order = vi.fn().mockReturnValue({ lte });
      const select = vi.fn().mockReturnValue({ order });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const tradingDays = createTradingDays(mock);
      const result = await tradingDays.getLatestClosed();

      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/trading-days.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `storage/src/trading-days.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider, DateRange } from '@livefolio/sdk';
import { paginatedSelect } from './paginate';

export function createTradingDays(supabase: SupabaseClient): StorageProvider['tradingDays'] {
  return {
    async getRange(range?: DateRange) {
      const data = await paginatedSelect<{ date: string }>(() => {
        let query = supabase.from('trading_days').select('date', { count: 'exact' });
        if (range?.from) query = query.gte('date', range.from);
        if (range?.to) query = query.lte('date', range.to);
        return query.order('date', { ascending: true });
      });
      return data.map((row) => row.date);
    },

    async getLatestClosed() {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('trading_days')
        .select('date')
        .order('close', { ascending: false })
        .lte('close', now)
        .limit(1)
        .single();
      if (error) return null;
      return data?.date ?? null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/trading-days.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/trading-days.ts storage/src/trading-days.test.ts
git commit -m "feat(storage): implement tradingDays namespace"
```

---

### Task 7: Indicators Namespace

**Files:**
- Create: `storage/src/indicators.ts`
- Create: `storage/src/indicators.test.ts`

This is the largest namespace (5 methods).

- [ ] **Step 1: Write the failing tests**

Create `storage/src/indicators.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createIndicators } from './indicators';

// Helper: build a mock Supabase client with chainable methods
function chainMock(terminalValue: unknown) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') return undefined; // not a thenable
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  // We'll build specific mocks per test instead
  return new Proxy({}, handler);
}

describe('createIndicators', () => {
  describe('upsert', () => {
    it('upserts an indicator identity and returns id', async () => {
      const single = vi.fn().mockResolvedValue({ data: { id: 5 }, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const upsert = vi.fn().mockReturnValue({ select });
      const from = vi.fn().mockReturnValue({ upsert });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      const result = await indicators.upsert({
        type: 'SMA',
        tickerId: 1,
        lookback: 200,
        delay: 0,
        unit: null,
        threshold: null,
      });

      expect(result).toEqual({ id: 5 });
      expect(from).toHaveBeenCalledWith('indicators');
      expect(upsert).toHaveBeenCalledWith(
        { type: 'SMA', ticker_id: 1, lookback: 200, delay: 0, unit: null, threshold: null },
        { onConflict: 'type,ticker_id,lookback,delay,unit,threshold' },
      );
    });

    it('throws on error', async () => {
      const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'bad' } });
      const select = vi.fn().mockReturnValue({ single });
      const upsert = vi.fn().mockReturnValue({ select });
      const from = vi.fn().mockReturnValue({ upsert });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      await expect(
        indicators.upsert({ type: 'SMA', tickerId: 1, lookback: 200, delay: 0, unit: null, threshold: null }),
      ).rejects.toThrow('indicators.upsert: bad');
    });
  });

  describe('getSeries', () => {
    it('returns DailyBar[] from joined query', async () => {
      const rows = [
        { value: 150.5, trading_days: { date: '2024-01-02' } },
        { value: 151.0, trading_days: { date: '2024-01-03' } },
      ];
      const range = vi.fn().mockResolvedValue({ data: rows, error: null, count: 2 });
      const order = vi.fn().mockReturnValue({ range });
      const lte = vi.fn().mockReturnValue({ order });
      const gte = vi.fn().mockReturnValue({ lte });
      const eq = vi.fn().mockReturnValue({ gte });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      const result = await indicators.getSeries(5, { from: '2024-01-02', to: '2024-01-03' });

      expect(result).toEqual([
        { date: '2024-01-02', value: 150.5 },
        { date: '2024-01-03', value: 151.0 },
      ]);
      expect(from).toHaveBeenCalledWith('indicators_series');
    });
  });

  describe('getLatestSeriesDate', () => {
    it('returns latest date from series', async () => {
      const single = vi.fn().mockResolvedValue({
        data: { trading_days: { date: '2024-06-14' } },
        error: null,
      });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      const result = await indicators.getLatestSeriesDate(5);

      expect(result).toBe('2024-06-14');
    });

    it('returns null when no series data exists', async () => {
      const single = vi.fn().mockResolvedValue({ data: null, error: null });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      const result = await indicators.getLatestSeriesDate(5);

      expect(result).toBeNull();
    });
  });

  describe('getValue', () => {
    it('returns value for latest date when no date specified', async () => {
      const single = vi.fn().mockResolvedValue({
        data: { value: 42.5 },
        error: null,
      });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      const result = await indicators.getValue(5);

      expect(result).toBe(42.5);
    });

    it('returns null when no data', async () => {
      const single = vi.fn().mockResolvedValue({ data: null, error: null });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      const result = await indicators.getValue(5);

      expect(result).toBeNull();
    });
  });

  describe('writeSeries', () => {
    it('resolves trading day IDs and upserts rows', async () => {
      // Mock for resolveTradingDayIds (trading_days query)
      const tradingDaysLte = vi.fn().mockResolvedValue({
        data: [
          { id: 10, date: '2024-01-02' },
          { id: 11, date: '2024-01-03' },
        ],
        error: null,
      });
      const tradingDaysGte = vi.fn().mockReturnValue({ lte: tradingDaysLte });
      const tradingDaysSelect = vi.fn().mockReturnValue({ gte: tradingDaysGte });

      // Mock for the upsert
      const upsertResult = vi.fn().mockResolvedValue({ error: null });

      const from = vi.fn().mockImplementation((table: string) => {
        if (table === 'trading_days') return { select: tradingDaysSelect };
        if (table === 'indicators_series') return { upsert: upsertResult };
        return {};
      });
      const mock = { from } as unknown as SupabaseClient;

      const indicators = createIndicators(mock);
      await indicators.writeSeries(5, [
        { date: '2024-01-02', value: 150.5 },
        { date: '2024-01-03', value: 151.0 },
      ]);

      expect(upsertResult).toHaveBeenCalledWith(
        [
          { indicator_id: 5, trading_day_id: 10, value: 150.5 },
          { indicator_id: 5, trading_day_id: 11, value: 151.0 },
        ],
        { onConflict: 'indicator_id,trading_day_id' },
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/indicators.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `storage/src/indicators.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider, DateRange, DailyBar } from '@livefolio/sdk';
import { resolveTradingDayIds } from './trading-day-ids';
import { paginatedSelect } from './paginate';

export function createIndicators(supabase: SupabaseClient): StorageProvider['indicators'] {
  return {
    async upsert(identity) {
      const { data, error } = await supabase
        .from('indicators')
        .upsert(
          {
            type: identity.type,
            ticker_id: identity.tickerId,
            lookback: identity.lookback,
            delay: identity.delay,
            unit: identity.unit,
            threshold: identity.threshold,
          },
          { onConflict: 'type,ticker_id,lookback,delay,unit,threshold' },
        )
        .select('id')
        .single();
      if (error) throw new Error(`indicators.upsert: ${error.message}`);
      return { id: data.id };
    },

    async getSeries(indicatorId, range?: DateRange) {
      const data = await paginatedSelect<{ value: number; trading_days: { date: string } }>(() => {
        let query = supabase
          .from('indicators_series')
          .select('value, trading_days(date)', { count: 'exact' })
          .eq('indicator_id', indicatorId);
        if (range?.from) query = query.gte('trading_days.date', range.from);
        if (range?.to) query = query.lte('trading_days.date', range.to);
        return query.order('trading_days(date)', { ascending: true });
      });
      return data.map((row) => ({
        date: row.trading_days.date,
        value: row.value,
      }));
    },

    async writeSeries(indicatorId, bars: DailyBar[]) {
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
      const { error } = await supabase
        .from('indicators_series')
        .upsert(rows, { onConflict: 'indicator_id,trading_day_id' });
      if (error) throw new Error(`indicators.writeSeries: ${error.message}`);
    },

    async getLatestSeriesDate(indicatorId) {
      const { data } = await supabase
        .from('indicators_series')
        .select('trading_days(date)')
        .eq('indicator_id', indicatorId)
        .order('trading_day_id', { ascending: false })
        .limit(1)
        .single();
      return data?.trading_days?.date ?? null;
    },

    async getValue(indicatorId, date?: string) {
      let query = supabase
        .from('indicators_series')
        .select('value, trading_days(date)')
        .eq('indicator_id', indicatorId);
      if (date) {
        query = query.eq('trading_days.date', date);
      } else {
        query = query.order('trading_day_id', { ascending: false });
      }
      const { data } = await query.limit(1).single();
      return data?.value ?? null;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/indicators.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/indicators.ts storage/src/indicators.test.ts
git commit -m "feat(storage): implement indicators namespace"
```

---

### Task 8: Signals Namespace

**Files:**
- Create: `storage/src/signals.ts`
- Create: `storage/src/signals.test.ts`

Structurally similar to indicators — same `getSeries`/`writeSeries`/`getLatestSeriesDate` pattern, but with `boolean` values stored in `signals_series` and a `getLastValue` instead of `getValue`.

- [ ] **Step 1: Write the failing tests**

Create `storage/src/signals.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSignals } from './signals';

describe('createSignals', () => {
  describe('upsert', () => {
    it('upserts a signal identity and returns id', async () => {
      const single = vi.fn().mockResolvedValue({ data: { id: 7 }, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const upsert = vi.fn().mockReturnValue({ select });
      const from = vi.fn().mockReturnValue({ upsert });
      const mock = { from } as unknown as SupabaseClient;

      const signals = createSignals(mock);
      const result = await signals.upsert({
        indicatorId1: 1,
        indicatorId2: 2,
        comparison: '>',
        tolerance: 5,
      });

      expect(result).toEqual({ id: 7 });
      expect(from).toHaveBeenCalledWith('signals');
      expect(upsert).toHaveBeenCalledWith(
        { indicator_id_1: 1, indicator_id_2: 2, comparison: '>', tolerance: 5 },
        { onConflict: 'indicator_id_1,indicator_id_2,comparison,tolerance' },
      );
    });
  });

  describe('getSeries', () => {
    it('returns DailyBar[] with boolean-to-number conversion', async () => {
      const rows = [
        { value: true, trading_days: { date: '2024-01-02' } },
        { value: false, trading_days: { date: '2024-01-03' } },
      ];
      const range = vi.fn().mockResolvedValue({ data: rows, error: null, count: 2 });
      const order = vi.fn().mockReturnValue({ range });
      const lte = vi.fn().mockReturnValue({ order });
      const gte = vi.fn().mockReturnValue({ lte });
      const eq = vi.fn().mockReturnValue({ gte });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const signals = createSignals(mock);
      const result = await signals.getSeries(7, { from: '2024-01-02', to: '2024-01-03' });

      expect(result).toEqual([
        { date: '2024-01-02', value: 1 },
        { date: '2024-01-03', value: 0 },
      ]);
    });
  });

  describe('getLastValue', () => {
    it('returns last signal value as 0 or 1', async () => {
      const single = vi.fn().mockResolvedValue({ data: { value: true }, error: null });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const signals = createSignals(mock);
      const result = await signals.getLastValue(7);

      expect(result).toBe(1);
    });

    it('returns null when no data', async () => {
      const single = vi.fn().mockResolvedValue({ data: null, error: null });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const signals = createSignals(mock);
      const result = await signals.getLastValue(7);

      expect(result).toBeNull();
    });
  });

  describe('writeSeries', () => {
    it('converts DailyBar values to booleans and upserts', async () => {
      const tradingDaysLte = vi.fn().mockResolvedValue({
        data: [{ id: 10, date: '2024-01-02' }, { id: 11, date: '2024-01-03' }],
        error: null,
      });
      const tradingDaysGte = vi.fn().mockReturnValue({ lte: tradingDaysLte });
      const tradingDaysSelect = vi.fn().mockReturnValue({ gte: tradingDaysGte });

      const upsertResult = vi.fn().mockResolvedValue({ error: null });

      const from = vi.fn().mockImplementation((table: string) => {
        if (table === 'trading_days') return { select: tradingDaysSelect };
        if (table === 'signals_series') return { upsert: upsertResult };
        return {};
      });
      const mock = { from } as unknown as SupabaseClient;

      const signals = createSignals(mock);
      await signals.writeSeries(7, [
        { date: '2024-01-02', value: 1 },
        { date: '2024-01-03', value: 0 },
      ]);

      expect(upsertResult).toHaveBeenCalledWith(
        [
          { signal_id: 7, trading_day_id: 10, value: true },
          { signal_id: 7, trading_day_id: 11, value: false },
        ],
        { onConflict: 'signal_id,trading_day_id' },
      );
    });
  });

  describe('getLatestSeriesDate', () => {
    it('returns latest date from signal series', async () => {
      const single = vi.fn().mockResolvedValue({
        data: { trading_days: { date: '2024-06-14' } },
        error: null,
      });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const signals = createSignals(mock);
      const result = await signals.getLatestSeriesDate(7);

      expect(result).toBe('2024-06-14');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/signals.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `storage/src/signals.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider, DateRange, DailyBar } from '@livefolio/sdk';
import { resolveTradingDayIds } from './trading-day-ids';
import { paginatedSelect } from './paginate';

export function createSignals(supabase: SupabaseClient): StorageProvider['signals'] {
  return {
    async upsert(identity) {
      const { data, error } = await supabase
        .from('signals')
        .upsert(
          {
            indicator_id_1: identity.indicatorId1,
            indicator_id_2: identity.indicatorId2,
            comparison: identity.comparison,
            tolerance: identity.tolerance,
          },
          { onConflict: 'indicator_id_1,indicator_id_2,comparison,tolerance' },
        )
        .select('id')
        .single();
      if (error) throw new Error(`signals.upsert: ${error.message}`);
      return { id: data.id };
    },

    async getSeries(signalId, range?: DateRange) {
      const data = await paginatedSelect<{ value: boolean; trading_days: { date: string } }>(() => {
        let query = supabase
          .from('signals_series')
          .select('value, trading_days(date)', { count: 'exact' })
          .eq('signal_id', signalId);
        if (range?.from) query = query.gte('trading_days.date', range.from);
        if (range?.to) query = query.lte('trading_days.date', range.to);
        return query.order('trading_days(date)', { ascending: true });
      });
      return data.map((row) => ({
        date: row.trading_days.date,
        value: row.value ? 1 : 0,
      }));
    },

    async writeSeries(signalId, bars: DailyBar[]) {
      if (bars.length === 0) return;
      const dayIds = await resolveTradingDayIds(
        supabase,
        bars.map((b) => b.date),
      );
      const rows = bars
        .filter((b) => dayIds.has(b.date))
        .map((b) => ({
          signal_id: signalId,
          trading_day_id: dayIds.get(b.date)!,
          value: b.value === 1,
        }));
      const { error } = await supabase
        .from('signals_series')
        .upsert(rows, { onConflict: 'signal_id,trading_day_id' });
      if (error) throw new Error(`signals.writeSeries: ${error.message}`);
    },

    async getLatestSeriesDate(signalId) {
      const { data } = await supabase
        .from('signals_series')
        .select('trading_days(date)')
        .eq('signal_id', signalId)
        .order('trading_day_id', { ascending: false })
        .limit(1)
        .single();
      return data?.trading_days?.date ?? null;
    },

    async getLastValue(signalId) {
      const { data } = await supabase
        .from('signals_series')
        .select('value')
        .eq('signal_id', signalId)
        .order('trading_day_id', { ascending: false })
        .limit(1)
        .single();
      if (!data) return null;
      return data.value ? 1 : 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/signals.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/signals.ts storage/src/signals.test.ts
git commit -m "feat(storage): implement signals namespace"
```

---

### Task 9: Allocations Namespace

**Files:**
- Create: `storage/src/allocations.ts`
- Create: `storage/src/allocations.test.ts`

Uses JSONB containment operators (`@>` and `<@`) to find matching allocations.

- [ ] **Step 1: Write the failing tests**

Create `storage/src/allocations.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAllocations } from './allocations';

describe('createAllocations', () => {
  describe('findOrCreate', () => {
    it('returns existing allocation when holdings match', async () => {
      const holdings = { SPY: 0.6, SHY: 0.4 };
      const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 3 }, error: null });
      const contains = vi.fn().mockReturnValue({ maybeSingle });
      const containedBy = vi.fn().mockReturnValue({ contains });
      const select = vi.fn().mockReturnValue({ containedBy });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const allocations = createAllocations(mock);
      const result = await allocations.findOrCreate(holdings);

      expect(result).toEqual({ id: 3 });
      expect(from).toHaveBeenCalledWith('allocations');
      expect(containedBy).toHaveBeenCalledWith('holdings', holdings);
      expect(contains).toHaveBeenCalledWith('holdings', holdings);
    });

    it('creates a new allocation when no match found', async () => {
      const holdings = { SPY: 1.0 };

      // First call: select returns null (no match)
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const contains = vi.fn().mockReturnValue({ maybeSingle });
      const containedBy = vi.fn().mockReturnValue({ contains });
      const selectFind = vi.fn().mockReturnValue({ containedBy });

      // Second call: insert returns new row
      const single = vi.fn().mockResolvedValue({ data: { id: 10 }, error: null });
      const selectInsert = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select: selectInsert });

      const from = vi.fn()
        .mockReturnValueOnce({ select: selectFind })
        .mockReturnValueOnce({ insert });
      const mock = { from } as unknown as SupabaseClient;

      const allocations = createAllocations(mock);
      const result = await allocations.findOrCreate(holdings);

      expect(result).toEqual({ id: 10 });
      expect(insert).toHaveBeenCalledWith({ holdings });
    });

    it('throws on insert error', async () => {
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const contains = vi.fn().mockReturnValue({ maybeSingle });
      const containedBy = vi.fn().mockReturnValue({ contains });
      const selectFind = vi.fn().mockReturnValue({ containedBy });

      const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } });
      const selectInsert = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select: selectInsert });

      const from = vi.fn()
        .mockReturnValueOnce({ select: selectFind })
        .mockReturnValueOnce({ insert });
      const mock = { from } as unknown as SupabaseClient;

      const allocations = createAllocations(mock);
      await expect(allocations.findOrCreate({ SPY: 1.0 })).rejects.toThrow(
        'allocations.findOrCreate: insert failed',
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/allocations.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `storage/src/allocations.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider } from '@livefolio/sdk';

export function createAllocations(supabase: SupabaseClient): StorageProvider['allocations'] {
  return {
    async findOrCreate(holdings) {
      // Try to find an existing allocation with exact JSONB match
      // Using bidirectional containment: holdings @> input AND holdings <@ input
      const { data: existing } = await supabase
        .from('allocations')
        .select('id')
        .containedBy('holdings', holdings)
        .contains('holdings', holdings)
        .maybeSingle();

      if (existing) return { id: existing.id };

      // No match — create a new one
      const { data, error } = await supabase
        .from('allocations')
        .insert({ holdings })
        .select('id')
        .single();
      if (error) throw new Error(`allocations.findOrCreate: ${error.message}`);
      return { id: data.id };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/allocations.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/allocations.ts storage/src/allocations.test.ts
git commit -m "feat(storage): implement allocations namespace"
```

---

### Task 10: Strategies Namespace

**Files:**
- Create: `storage/src/strategies.ts`
- Create: `storage/src/strategies.test.ts`

The most complex namespace — includes `resolveReference` with its multi-step fan-out query.

- [ ] **Step 1: Write the failing tests**

Create `storage/src/strategies.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createStrategies } from './strategies';

describe('createStrategies', () => {
  describe('create', () => {
    it('creates a strategy and returns id', async () => {
      const single = vi.fn().mockResolvedValue({ data: { id: 20 }, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      const from = vi.fn().mockReturnValue({ insert });
      const mock = { from } as unknown as SupabaseClient;

      const strategies = createStrategies(mock);
      const result = await strategies.create({
        linkId: 'abc123',
        name: 'My Strategy',
        freq: 'Monthly',
        offset: 0,
        rules: [{ signalIds: [1, 2], allocationId: 3 }, { allocationId: 4 }],
      });

      expect(result).toEqual({ id: 20 });
      expect(from).toHaveBeenCalledWith('strategies');
      expect(insert).toHaveBeenCalledWith({
        link_id: 'abc123',
        name: 'My Strategy',
        trading_freq: 'Monthly',
        trading_offset: 0,
        definition: [{ signalIds: [1, 2], allocationId: 3 }, { allocationId: 4 }],
      });
    });
  });

  describe('getSeries', () => {
    it('returns StrategySeriesEntry[] from joined query', async () => {
      const rows = [
        { allocation_id: 3, trading_days: { date: '2024-01-02' } },
        { allocation_id: 4, trading_days: { date: '2024-01-03' } },
      ];
      const range = vi.fn().mockResolvedValue({ data: rows, error: null, count: 2 });
      const order = vi.fn().mockReturnValue({ range });
      const lte = vi.fn().mockReturnValue({ order });
      const gte = vi.fn().mockReturnValue({ lte });
      const eq = vi.fn().mockReturnValue({ gte });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const strategies = createStrategies(mock);
      const result = await strategies.getSeries(20, { from: '2024-01-02', to: '2024-01-03' });

      expect(result).toEqual([
        { date: '2024-01-02', allocationId: 3 },
        { date: '2024-01-03', allocationId: 4 },
      ]);
    });
  });

  describe('getLatestSeriesDate', () => {
    it('returns the latest date', async () => {
      const single = vi.fn().mockResolvedValue({
        data: { trading_days: { date: '2024-06-14' } },
        error: null,
      });
      const limit = vi.fn().mockReturnValue({ single });
      const order = vi.fn().mockReturnValue({ limit });
      const eq = vi.fn().mockReturnValue({ order });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });
      const mock = { from } as unknown as SupabaseClient;

      const strategies = createStrategies(mock);
      const result = await strategies.getLatestSeriesDate(20);

      expect(result).toBe('2024-06-14');
    });
  });

  describe('writeSeries', () => {
    it('resolves trading day IDs and upserts entries', async () => {
      const tradingDaysLte = vi.fn().mockResolvedValue({
        data: [{ id: 10, date: '2024-01-02' }, { id: 11, date: '2024-01-03' }],
        error: null,
      });
      const tradingDaysGte = vi.fn().mockReturnValue({ lte: tradingDaysLte });
      const tradingDaysSelect = vi.fn().mockReturnValue({ gte: tradingDaysGte });

      const upsertResult = vi.fn().mockResolvedValue({ error: null });

      const from = vi.fn().mockImplementation((table: string) => {
        if (table === 'trading_days') return { select: tradingDaysSelect };
        if (table === 'strategies_series') return { upsert: upsertResult };
        return {};
      });
      const mock = { from } as unknown as SupabaseClient;

      const strategies = createStrategies(mock);
      await strategies.writeSeries(20, [
        { date: '2024-01-02', allocationId: 3 },
        { date: '2024-01-03', allocationId: 4 },
      ]);

      expect(upsertResult).toHaveBeenCalledWith(
        [
          { strategies_id: 20, trading_day_id: 10, allocation_id: 3 },
          { strategies_id: 20, trading_day_id: 11, allocation_id: 4 },
        ],
        { onConflict: 'strategies_id,trading_day_id' },
      );
    });
  });

  describe('resolveReference', () => {
    it('resolves full strategy graph from link_id', async () => {
      const strategy = {
        id: 20,
        name: 'Tactical',
        trading_freq: 'Monthly',
        trading_offset: 0,
        definition: [
          { signalIds: [1], allocationId: 10 },
          { allocationId: 11 },
        ],
      };
      const signalRows = [
        { id: 1, indicator_id_1: 100, indicator_id_2: 101, comparison: '>', tolerance: 5 },
      ];
      const allocationRows = [
        { id: 10, holdings: { SPY: 0.6, SHY: 0.4 } },
        { id: 11, holdings: { SHY: 1.0 } },
      ];
      const indicatorRows = [
        { id: 100, type: 'Price', ticker_id: 50, lookback: 0, delay: 0, unit: null, threshold: null },
        { id: 101, type: 'SMA', ticker_id: 50, lookback: 200, delay: 0, unit: null, threshold: null },
      ];
      const tickerRows = [{ id: 50, symbol: 'SPY', leverage: 1 }];

      const from = vi.fn().mockImplementation((table: string) => {
        if (table === 'strategies') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: strategy, error: null }),
              }),
            }),
          };
        }
        if (table === 'signals') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: signalRows, error: null }),
            }),
          };
        }
        if (table === 'allocations') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: allocationRows, error: null }),
            }),
          };
        }
        if (table === 'indicators') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: indicatorRows, error: null }),
            }),
          };
        }
        if (table === 'tickers') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: tickerRows, error: null }),
            }),
          };
        }
        return {};
      });
      const mock = { from } as unknown as SupabaseClient;

      const strategies = createStrategies(mock);
      const result = await strategies.resolveReference('abc123');

      expect(result.id).toBe(20);
      expect(result.name).toBe('Tactical');
      expect(result.freq).toBe('Monthly');
      expect(result.offset).toBe(0);
      expect(result.rules.signals).toEqual([
        { id: 1, indicatorId1: 100, indicatorId2: 101, comparison: '>', tolerance: 5 },
      ]);
      expect(result.rules.allocations).toEqual([
        { id: 10, holdings: { SPY: 0.6, SHY: 0.4 } },
        { id: 11, holdings: { SHY: 1.0 } },
      ]);
      expect(result.rules.indicators).toEqual([
        { id: 100, type: 'Price', tickerId: 50, lookback: 0, delay: 0, unit: null, threshold: null },
        { id: 101, type: 'SMA', tickerId: 50, lookback: 200, delay: 0, unit: null, threshold: null },
      ]);
      expect(result.rules.tickers).toEqual([{ id: 50, symbol: 'SPY', leverage: 1 }]);
      expect(result.rules.definition).toEqual(strategy.definition);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd storage && npx vitest run src/strategies.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `storage/src/strategies.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider, DateRange } from '@livefolio/sdk';
import type { StrategySeriesEntry, StrategyDefinition, StrategyReferenceData } from '@livefolio/sdk';
import { resolveTradingDayIds } from './trading-day-ids';
import { paginatedSelect } from './paginate';

export function createStrategies(supabase: SupabaseClient): StorageProvider['strategies'] {
  return {
    async create(definition: StrategyDefinition) {
      const { data, error } = await supabase
        .from('strategies')
        .insert({
          link_id: definition.linkId,
          name: definition.name,
          trading_freq: definition.freq,
          trading_offset: definition.offset,
          definition: definition.rules,
        })
        .select('id')
        .single();
      if (error) throw new Error(`strategies.create: ${error.message}`);
      return { id: data.id };
    },

    async getSeries(strategyId, range?: DateRange) {
      const data = await paginatedSelect<{
        allocation_id: number;
        trading_days: { date: string };
      }>(() => {
        let query = supabase
          .from('strategies_series')
          .select('allocation_id, trading_days(date)', { count: 'exact' })
          .eq('strategies_id', strategyId);
        if (range?.from) query = query.gte('trading_days.date', range.from);
        if (range?.to) query = query.lte('trading_days.date', range.to);
        return query.order('trading_days(date)', { ascending: true });
      });
      return data.map((row) => ({
        date: row.trading_days.date,
        allocationId: row.allocation_id,
      }));
    },

    async writeSeries(strategyId, entries: StrategySeriesEntry[]) {
      if (entries.length === 0) return;
      const dayIds = await resolveTradingDayIds(
        supabase,
        entries.map((e) => e.date),
      );
      const rows = entries
        .filter((e) => dayIds.has(e.date))
        .map((e) => ({
          strategies_id: strategyId,
          trading_day_id: dayIds.get(e.date)!,
          allocation_id: e.allocationId,
        }));
      const { error } = await supabase
        .from('strategies_series')
        .upsert(rows, { onConflict: 'strategies_id,trading_day_id' });
      if (error) throw new Error(`strategies.writeSeries: ${error.message}`);
    },

    async getLatestSeriesDate(strategyId) {
      const { data } = await supabase
        .from('strategies_series')
        .select('trading_days(date)')
        .eq('strategies_id', strategyId)
        .order('trading_day_id', { ascending: false })
        .limit(1)
        .single();
      return data?.trading_days?.date ?? null;
    },

    async resolveReference(linkId: string): Promise<StrategyReferenceData> {
      // 1. Fetch strategy
      const { data: strategy, error: stratErr } = await supabase
        .from('strategies')
        .select('id, name, trading_freq, trading_offset, definition')
        .eq('link_id', linkId)
        .single();
      if (stratErr) throw new Error(`strategies.resolveReference: ${stratErr.message}`);

      const definition = strategy.definition as { signalIds?: number[]; allocationId: number }[];

      // 2. Collect IDs from definition
      const signalIds = [...new Set(definition.flatMap((r) => r.signalIds ?? []))];
      const allocationIds = [...new Set(definition.map((r) => r.allocationId))];

      // 3. Parallel: fetch signals + allocations
      const [signalsResult, allocationsResult] = await Promise.all([
        signalIds.length > 0
          ? supabase
              .from('signals')
              .select('id, indicator_id_1, indicator_id_2, comparison, tolerance')
              .in('id', signalIds)
          : { data: [], error: null },
        supabase
          .from('allocations')
          .select('id, holdings')
          .in('id', allocationIds),
      ]);

      if (signalsResult.error) throw new Error(`strategies.resolveReference: ${signalsResult.error.message}`);
      if (allocationsResult.error) throw new Error(`strategies.resolveReference: ${allocationsResult.error.message}`);

      const signalRows = signalsResult.data ?? [];
      const allocationRows = allocationsResult.data ?? [];

      // 4. Collect indicator IDs from signals
      const indicatorIds = [
        ...new Set(signalRows.flatMap((s) => [s.indicator_id_1, s.indicator_id_2])),
      ];

      // 5. Fetch indicators
      const { data: indicatorRows, error: indErr } = indicatorIds.length > 0
        ? await supabase
            .from('indicators')
            .select('id, type, ticker_id, lookback, delay, unit, threshold')
            .in('id', indicatorIds)
        : { data: [], error: null };
      if (indErr) throw new Error(`strategies.resolveReference: ${indErr.message}`);

      // 6. Collect ticker IDs from indicators
      const tickerIds = [
        ...new Set((indicatorRows ?? []).map((i) => i.ticker_id).filter((id): id is number => id != null)),
      ];

      // 7. Fetch tickers
      const { data: tickerRows, error: tickErr } = tickerIds.length > 0
        ? await supabase
            .from('tickers')
            .select('id, symbol, leverage')
            .in('id', tickerIds)
        : { data: [], error: null };
      if (tickErr) throw new Error(`strategies.resolveReference: ${tickErr.message}`);

      // 8. Assemble
      return {
        id: strategy.id,
        name: strategy.name,
        freq: strategy.trading_freq,
        offset: strategy.trading_offset,
        rules: {
          signals: signalRows.map((s) => ({
            id: s.id,
            indicatorId1: s.indicator_id_1,
            indicatorId2: s.indicator_id_2,
            comparison: s.comparison,
            tolerance: s.tolerance,
          })),
          allocations: allocationRows.map((a) => ({
            id: a.id,
            holdings: a.holdings,
          })),
          indicators: (indicatorRows ?? []).map((i) => ({
            id: i.id,
            type: i.type,
            tickerId: i.ticker_id,
            lookback: i.lookback,
            delay: i.delay,
            unit: i.unit,
            threshold: i.threshold,
          })),
          tickers: (tickerRows ?? []).map((t) => ({
            id: t.id,
            symbol: t.symbol,
            leverage: t.leverage,
          })),
          definition,
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd storage && npx vitest run src/strategies.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add storage/src/strategies.ts storage/src/strategies.test.ts
git commit -m "feat(storage): implement strategies namespace with resolveReference"
```

---

### Task 11: Wire Up Index and Build

**Files:**
- Modify: `storage/src/index.ts`

- [ ] **Step 1: Write the factory and exports**

Replace `storage/src/index.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider } from '@livefolio/sdk';
import { createTickers } from './tickers';
import { createIndicators } from './indicators';
import { createSignals } from './signals';
import { createAllocations } from './allocations';
import { createStrategies } from './strategies';
import { createTradingDays } from './trading-days';

export function createSupabaseStorage(supabase: SupabaseClient): StorageProvider {
  return {
    tickers: createTickers(supabase),
    indicators: createIndicators(supabase),
    signals: createSignals(supabase),
    allocations: createAllocations(supabase),
    strategies: createStrategies(supabase),
    tradingDays: createTradingDays(supabase),
  };
}

export type { Database } from './database.types';
```

- [ ] **Step 2: Run all tests**

```bash
cd storage && npm test
```

Expected: All tests across all files PASS.

- [ ] **Step 3: Run the build**

```bash
cd storage && npm run build
```

Expected: `dist/index.js`, `dist/index.d.ts` created. No errors. The `Database` type and `createSupabaseStorage` are both exported.

- [ ] **Step 4: Run lint and format**

```bash
cd storage && npm run lint && npm run format:check
```

Expected: No lint errors, no format issues. Fix any issues that arise.

- [ ] **Step 5: Commit**

```bash
git add storage/src/index.ts
git commit -m "feat(storage): wire up createSupabaseStorage factory and exports"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd storage && npm test
```

Expected: All tests PASS.

- [ ] **Step 2: Run build**

```bash
cd storage && npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 3: Verify exports**

```bash
cd storage && node -e "import('./dist/index.js').then(m => console.log(Object.keys(m)))"
```

Expected: `['createSupabaseStorage', 'Database']` (or similar — `Database` is a type so may not appear at runtime, but the `.d.ts` should export it).

- [ ] **Step 4: Verify SDK can consume the storage provider**

From the `sdk/` directory, verify TypeScript accepts the storage provider:

```bash
cd sdk && npx tsc --noEmit
```

Expected: No errors. The SDK's `createClient({ storage, market })` should accept the return type of `createSupabaseStorage()`.

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A storage/
git commit -m "chore(storage): final verification and cleanup"
```
