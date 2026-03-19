# Getting Started

## Installation

```bash
npm install @livefolio/sdk @supabase/supabase-js
```

## Setup

The SDK requires a typed Supabase client. Create one and pass it to `createLivefolioClient`:

```ts
import { createClient } from '@supabase/supabase-js';
import { createLivefolioClient } from '@livefolio/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

const livefolio = createLivefolioClient(supabase);
```

This gives you access to all four modules:

```ts
livefolio.auth       // Authentication
livefolio.market     // Market data
livefolio.strategy   // Strategy evaluation
livefolio.portfolio  // Portfolio management (stub)
```

## Current Scope

Today the SDK is most complete in:

- `market`: historical series, quotes, and trading-calendar access
- `strategy`: retrieval, deterministic evaluation, live streaming, rules compilation, and backtesting
- `portfolio`: rebalance planning, drift measurement, and tradable ticker mapping

`auth` is intentionally narrow, and `portfolio` should be read as portfolio tooling rather than a full broker integration layer.

## Where The Community Can Help

High-value contribution areas include:

- Indicators, signals, and evaluation semantics
- Alternative market data providers and adapters
- Backtesting realism and analytics
- Broker and execution integrations
- Examples, tutorials, and framework integrations
- Benchmarks, caching, and broader test coverage

## Running The SDK Locally

For most contributions, the local workflow is:

```bash
npm install
npm run build
npm test
```

The SDK test suite is unit-test-focused and usually does not require a live Supabase backend.

For ingestion or smoke-test workflows, configure local credentials first:

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=<local-anon-key>
export SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```

Then run:

```bash
npm run ingest:init
npm run ingest:daily
npm run backtest:smoke -- --linkId <strategy-link-id>
```

## Importing individual modules

You can also import module factories directly:

```ts
import { createMarket } from '@livefolio/sdk/market';
import { createStrategy } from '@livefolio/sdk/strategy';
import { createAuth } from '@livefolio/sdk/auth';
```

## TypedSupabaseClient

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@livefolio/db';

type TypedSupabaseClient = SupabaseClient<Database>;
```

All module factories accept this as their sole argument.
