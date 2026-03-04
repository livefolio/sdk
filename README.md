# @livefolio/sdk

TypeScript SDK for market data, strategy evaluation, and portfolio management.

## Install

```bash
npm install @livefolio/sdk
```

## Quick Start

```ts
import { createLivefolioClient } from '@livefolio/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const livefolio = createLivefolioClient(supabase);
```

## Modules

| Module | Description |
|--------|-------------|
| `livefolio.auth` | Authentication (user, session, sign-out) |
| `livefolio.market` | Historical series, real-time quotes, trading calendar |
| `livefolio.strategy` | Strategy retrieval, cached evaluation, live streaming |
| `livefolio.portfolio` | Brokerage account aggregation (stub) |

```ts
// Fetch and evaluate a strategy
const strategy = await livefolio.strategy.get('abc-123');
if (strategy) {
  const result = await livefolio.strategy.evaluate(strategy, new Date());
  console.log(result.allocation.name, result.allocation.holdings);
}

// Market data
const series = await livefolio.market.getBatchSeries(['SPY', 'BND']);
const quote = await livefolio.market.getQuote('SPY');
```

Modules can also be imported individually:

```ts
import { createMarket } from '@livefolio/sdk/market';
import { createStrategy } from '@livefolio/sdk/strategy';
```

## Documentation

Full method reference, arguments, return types, and usage examples: **[docs/](./docs/)**

## Development

```bash
npm run build    # compile TypeScript → dist/
npm test         # run tests
```

PRs to `main` run build + tests and enforce a version bump. Merges auto-publish to npm.

## License

MIT
