# @livefolio/market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `@livefolio/market` package that implements the SDK's `MarketProvider` interface, fetching historical data from Yahoo Finance and FRED.

**Architecture:** Single factory `createYahooFredMarket({ fredApiKey })` returns a `MarketProvider`. An internal router dispatches to Yahoo or FRED fetchers based on an explicit symbol allowlist. Typed `MarketFetchError` wraps all failures.

**Tech Stack:** TypeScript, tsup (bundler), vitest, yahoo-finance2, native fetch (FRED)

**Spec:** `sdk/docs/specs/2026-04-02-market-package-design.md`

---

### Task 1: Scaffold the repo

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.gitignore`
- Create: `src/index.ts` (empty placeholder)

- [ ] **Step 1: Create the repo directory and initialize git**

```bash
mkdir -p ~/Documents/Personal/market
cd ~/Documents/Personal/market
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@livefolio/market",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write 'src/**/*.ts'",
    "format:check": "prettier --check 'src/**/*.ts'"
  },
  "peerDependencies": {
    "@livefolio/sdk": ">=0.0.1"
  },
  "dependencies": {
    "yahoo-finance2": "^2.14.0"
  },
  "devDependencies": {
    "@livefolio/sdk": "file:../livefolio-2/sdk",
    "tsup": "^8.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "prettier": "^3.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 4: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
});
```

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 6: Create eslint.config.js**

```javascript
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/'],
  },
);
```

- [ ] **Step 7: Create .prettierrc**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 8: Create .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 9: Create empty src/index.ts**

```typescript
// @livefolio/market
```

- [ ] **Step 10: Install dependencies**

```bash
npm install
```

- [ ] **Step 11: Verify build and test commands work**

```bash
npm run build
npm test
```

Expected: Both pass (no tests yet, build produces empty dist).

- [ ] **Step 12: Commit**

```bash
git add .
git commit -m "chore: scaffold @livefolio/market package"
```

---

### Task 2: MarketFetchError

**Files:**
- Create: `src/errors.ts`
- Create: `src/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/errors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MarketFetchError } from './errors';

describe('MarketFetchError', () => {
  it('sets name, source, symbol, and cause', () => {
    const cause = new Error('network timeout');
    const err = new MarketFetchError('yahoo', 'SPY', cause);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MarketFetchError');
    expect(err.source).toBe('yahoo');
    expect(err.symbol).toBe('SPY');
    expect(err.cause).toBe(cause);
    expect(err.message).toBe('Failed to fetch SPY from yahoo: network timeout');
  });

  it('handles non-Error cause', () => {
    const err = new MarketFetchError('fred', 'DGS10', 'string error');

    expect(err.message).toBe('Failed to fetch DGS10 from fred: string error');
    expect(err.cause).toBe('string error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/errors.test.ts
```

Expected: FAIL — `./errors` module not found.

- [ ] **Step 3: Write implementation**

Create `src/errors.ts`:

```typescript
export class MarketFetchError extends Error {
  constructor(
    public readonly source: 'yahoo' | 'fred',
    public readonly symbol: string,
    public readonly cause: unknown,
  ) {
    super(
      `Failed to fetch ${symbol} from ${source}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'MarketFetchError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/errors.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/errors.test.ts
git commit -m "feat: add MarketFetchError class"
```

---

### Task 3: Symbol router

**Files:**
- Create: `src/router.ts`
- Create: `src/router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/router.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { routeSymbol } from './router';

describe('routeSymbol', () => {
  it.each([
    'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3',
    'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
    'DTB3', 'DTB6',
  ])('routes %s to fred', (symbol) => {
    expect(routeSymbol(symbol)).toBe('fred');
  });

  it.each([
    'SPY', 'QQQ', 'AAPL', '^VIX', '^VIX3M', 'IWM', 'TLT',
  ])('routes %s to yahoo', (symbol) => {
    expect(routeSymbol(symbol)).toBe('yahoo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/router.test.ts
```

Expected: FAIL — `./router` module not found.

- [ ] **Step 3: Write implementation**

Create `src/router.ts`:

```typescript
export type DataSource = 'yahoo' | 'fred';

const FRED_SERIES = new Set([
  // Treasury constant maturity rates
  'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3',
  'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
  // Treasury bill rates
  'DTB3', 'DTB6',
]);

export function routeSymbol(symbol: string): DataSource {
  if (FRED_SERIES.has(symbol)) return 'fred';
  return 'yahoo';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/router.test.ts
```

Expected: PASS (all parametrized cases).

- [ ] **Step 5: Commit**

```bash
git add src/router.ts src/router.test.ts
git commit -m "feat: add symbol router with FRED allowlist"
```

---

### Task 4: Yahoo Finance fetcher

**Files:**
- Create: `src/yahoo.ts`
- Create: `src/yahoo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/yahoo.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketFetchError } from './errors';

// Mock yahoo-finance2 before importing the module under test
vi.mock('yahoo-finance2', () => ({
  default: {
    chart: vi.fn(),
  },
}));

import yahooFinance from 'yahoo-finance2';
import { fetchYahooBars } from './yahoo';

const mockChart = vi.mocked(yahooFinance.chart);

describe('fetchYahooBars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps chart quotes to DailyBar[]', async () => {
    mockChart.mockResolvedValue({
      quotes: [
        { date: new Date('2025-03-27T00:00:00Z'), close: 100 },
        { date: new Date('2025-03-28T00:00:00Z'), close: 101 },
      ],
    } as ReturnType<typeof yahooFinance.chart> extends Promise<infer T> ? T : never);

    const bars = await fetchYahooBars('SPY');

    expect(bars).toEqual([
      { date: '2025-03-27', value: 100 },
      { date: '2025-03-28', value: 101 },
    ]);
    expect(mockChart).toHaveBeenCalledWith('SPY', { interval: '1d' });
  });

  it('passes from as period1 when provided', async () => {
    mockChart.mockResolvedValue({ quotes: [] } as any);

    await fetchYahooBars('SPY', '2025-01-01');

    expect(mockChart).toHaveBeenCalledWith('SPY', {
      period1: '2025-01-01',
      interval: '1d',
    });
  });

  it('omits period1 when from is not provided', async () => {
    mockChart.mockResolvedValue({ quotes: [] } as any);

    await fetchYahooBars('^VIX');

    expect(mockChart).toHaveBeenCalledWith('^VIX', { interval: '1d' });
  });

  it('throws MarketFetchError on failure', async () => {
    mockChart.mockRejectedValue(new Error('API rate limit'));

    await expect(fetchYahooBars('SPY')).rejects.toThrow(MarketFetchError);
    await expect(fetchYahooBars('SPY')).rejects.toMatchObject({
      source: 'yahoo',
      symbol: 'SPY',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/yahoo.test.ts
```

Expected: FAIL — `./yahoo` module not found.

- [ ] **Step 3: Write implementation**

Create `src/yahoo.ts`:

```typescript
import yahooFinance from 'yahoo-finance2';
import type { DailyBar } from '@livefolio/sdk';
import { MarketFetchError } from './errors';

export async function fetchYahooBars(
  symbol: string,
  from?: string,
): Promise<DailyBar[]> {
  try {
    const result = await yahooFinance.chart(symbol, {
      ...(from && { period1: from }),
      interval: '1d',
    });

    return result.quotes.map((q) => ({
      date: q.date.toISOString().slice(0, 10),
      value: q.close,
    }));
  } catch (err) {
    throw new MarketFetchError('yahoo', symbol, err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/yahoo.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/yahoo.ts src/yahoo.test.ts
git commit -m "feat: add Yahoo Finance fetcher"
```

---

### Task 5: FRED fetcher

**Files:**
- Create: `src/fred.ts`
- Create: `src/fred.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/fred.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketFetchError } from './errors';
import { fetchFredBars } from './fred';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchFredBars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses FRED observations into DailyBar[]', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        observations: [
          { date: '2025-03-27', value: '4.25' },
          { date: '2025-03-28', value: '4.30' },
        ],
      }),
    );

    const bars = await fetchFredBars('DGS10', 'test-key');

    expect(bars).toEqual([
      { date: '2025-03-27', value: 4.25 },
      { date: '2025-03-28', value: 4.3 },
    ]);
  });

  it('filters out missing values (dot notation)', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        observations: [
          { date: '2025-03-27', value: '4.25' },
          { date: '2025-03-28', value: '.' },
          { date: '2025-03-31', value: '4.28' },
        ],
      }),
    );

    const bars = await fetchFredBars('DGS10', 'test-key');

    expect(bars).toEqual([
      { date: '2025-03-27', value: 4.25 },
      { date: '2025-03-31', value: 4.28 },
    ]);
  });

  it('passes observation_start when from is provided', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ observations: [] }));

    await fetchFredBars('DGS10', 'test-key', '2025-01-01');

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('observation_start')).toBe('2025-01-01');
    expect(url.searchParams.get('series_id')).toBe('DGS10');
    expect(url.searchParams.get('api_key')).toBe('test-key');
    expect(url.searchParams.get('file_type')).toBe('json');
  });

  it('omits observation_start when from is not provided', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ observations: [] }));

    await fetchFredBars('DGS10', 'test-key');

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.has('observation_start')).toBe(false);
  });

  it('throws MarketFetchError on non-OK response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));

    await expect(fetchFredBars('DGS10', 'test-key')).rejects.toThrow(MarketFetchError);
    await expect(fetchFredBars('DGS10', 'test-key')).rejects.toMatchObject({
      source: 'fred',
      symbol: 'DGS10',
    });
  });

  it('throws MarketFetchError on network error', async () => {
    mockFetch.mockRejectedValue(new Error('network failure'));

    await expect(fetchFredBars('DGS10', 'test-key')).rejects.toThrow(MarketFetchError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/fred.test.ts
```

Expected: FAIL — `./fred` module not found.

- [ ] **Step 3: Write implementation**

Create `src/fred.ts`:

```typescript
import type { DailyBar } from '@livefolio/sdk';
import { MarketFetchError } from './errors';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

export async function fetchFredBars(
  seriesId: string,
  apiKey: string,
  from?: string,
): Promise<DailyBar[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    ...(from && { observation_start: from }),
  });

  try {
    const res = await fetch(`${FRED_BASE}?${params}`);
    if (!res.ok) {
      throw new Error(`FRED API returned ${res.status}`);
    }

    const data = await res.json();

    return data.observations
      .filter((o: { value: string }) => o.value !== '.')
      .map((o: { date: string; value: string }) => ({
        date: o.date,
        value: parseFloat(o.value),
      }));
  } catch (err) {
    throw new MarketFetchError('fred', seriesId, err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/fred.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/fred.ts src/fred.test.ts
git commit -m "feat: add FRED API fetcher"
```

---

### Task 6: Factory and public API

**Files:**
- Modify: `src/index.ts`
- Create: `src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createYahooFredMarket, MarketFetchError } from './index';

// Mock the fetchers
vi.mock('./yahoo', () => ({
  fetchYahooBars: vi.fn(),
}));
vi.mock('./fred', () => ({
  fetchFredBars: vi.fn(),
}));

import { fetchYahooBars } from './yahoo';
import { fetchFredBars } from './fred';

const mockYahoo = vi.mocked(fetchYahooBars);
const mockFred = vi.mocked(fetchFredBars);

describe('createYahooFredMarket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes equity symbols to Yahoo', async () => {
    mockYahoo.mockResolvedValue([{ date: '2025-03-28', value: 100 }]);

    const market = createYahooFredMarket({ fredApiKey: 'test-key' });
    const bars = await market.fetchBars('SPY');

    expect(bars).toEqual([{ date: '2025-03-28', value: 100 }]);
    expect(mockYahoo).toHaveBeenCalledWith('SPY', undefined);
    expect(mockFred).not.toHaveBeenCalled();
  });

  it('routes VIX symbols to Yahoo', async () => {
    mockYahoo.mockResolvedValue([]);

    const market = createYahooFredMarket({ fredApiKey: 'test-key' });
    await market.fetchBars('^VIX');

    expect(mockYahoo).toHaveBeenCalledWith('^VIX', undefined);
    expect(mockFred).not.toHaveBeenCalled();
  });

  it('routes FRED series to FRED', async () => {
    mockFred.mockResolvedValue([{ date: '2025-03-28', value: 4.25 }]);

    const market = createYahooFredMarket({ fredApiKey: 'test-key' });
    const bars = await market.fetchBars('DGS10');

    expect(bars).toEqual([{ date: '2025-03-28', value: 4.25 }]);
    expect(mockFred).toHaveBeenCalledWith('DGS10', 'test-key', undefined);
    expect(mockYahoo).not.toHaveBeenCalled();
  });

  it('passes from parameter through to Yahoo', async () => {
    mockYahoo.mockResolvedValue([]);

    const market = createYahooFredMarket({ fredApiKey: 'test-key' });
    await market.fetchBars('SPY', '2025-01-01');

    expect(mockYahoo).toHaveBeenCalledWith('SPY', '2025-01-01');
  });

  it('passes from parameter through to FRED', async () => {
    mockFred.mockResolvedValue([]);

    const market = createYahooFredMarket({ fredApiKey: 'test-key' });
    await market.fetchBars('DGS10', '2025-01-01');

    expect(mockFred).toHaveBeenCalledWith('DGS10', 'test-key', '2025-01-01');
  });

  it('re-exports MarketFetchError', () => {
    expect(MarketFetchError).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/index.test.ts
```

Expected: FAIL — `createYahooFredMarket` not exported.

- [ ] **Step 3: Write implementation**

Replace `src/index.ts`:

```typescript
import type { MarketProvider } from '@livefolio/sdk';
import { routeSymbol } from './router';
import { fetchYahooBars } from './yahoo';
import { fetchFredBars } from './fred';

export { MarketFetchError } from './errors';

export interface YahooFredMarketOptions {
  fredApiKey: string;
}

export function createYahooFredMarket(options: YahooFredMarketOptions): MarketProvider {
  const { fredApiKey } = options;

  return {
    async fetchBars(symbol, from) {
      const source = routeSymbol(symbol);

      if (source === 'fred') {
        return fetchFredBars(symbol, fredApiKey, from);
      }

      return fetchYahooBars(symbol, from);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/index.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All tests pass across all files.

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: `dist/` contains `index.js`, `index.d.ts` and supporting chunks.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/index.test.ts
git commit -m "feat: add createYahooFredMarket factory"
```
