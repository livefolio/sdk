# @livefolio/sdk

TypeScript SDK for market data, strategy evaluation, and portfolio management.

## Install

```bash
npm install @livefolio/sdk
```

## Usage

```ts
import { createLivefolioClient } from '@livefolio/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const livefolio = createLivefolioClient(supabase);

// Market data
const series = await livefolio.market.getSeries('SPY');
const batch = await livefolio.market.getBatchSeries(['SPY', 'QQQ']);
const days = await livefolio.market.getTradingDays('2025-01-01', '2025-12-31');

// Auth
const user = await livefolio.auth.getUser();
```

Individual modules can also be imported directly:

```ts
import { createMarket } from '@livefolio/sdk/market';
import { createAuth } from '@livefolio/sdk/auth';
```

## Modules

- **auth** — Authentication (user, session, sign-out)
- **market** — Market data series and trading calendar
- **evaluator** — Strategy evaluation (planned)
- **portfolio** — Brokerage aggregation and trade management (planned)

## Development

```bash
npm install
npm run build    # compile TypeScript → dist/
npm test         # run tests
```

## CI/CD

- PRs to `main` run build + tests and enforce a version bump
- Merges to `main` auto-publish to npm and create a GitHub release

Before merging, bump the version:

```bash
npm version patch
```

## License

MIT
