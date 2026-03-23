# @livefolio/sdk

Open-source TypeScript SDK for market data, deterministic strategy evaluation and backtesting, live signal streaming, and portfolio rebalance planning.

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

## What The SDK Supports Today

The current public surface is strongest in four areas:

- Market data: historical daily series, quotes, trading-day lookups, and tracked ticker helpers
- Strategy engine: strategy retrieval, deterministic evaluation, pure evaluation helpers, live streaming updates, and rules compilation
- Backtesting: DB-backed historical backtests plus performance metric helpers
- Portfolio tooling: drift calculations, rebalance planning, and ticker-to-tradable mapping

`livefolio.auth` is intentionally lightweight, and `livefolio.portfolio` is best described today as portfolio tooling rather than a full brokerage integration layer.

## Community Contribution Areas

Good areas for community contributions:

- New indicator types and strategy primitives
- Additional market data adapters and quote providers
- Backtest realism improvements such as fees, slippage, taxes, and execution assumptions
- Portfolio and rebalancing logic, including tradable mappings and execution planning
- Broker and custodian adapters
- Examples, docs, notebooks, and app integrations
- Performance, caching, and test coverage improvements

If you are evaluating where to contribute first, the highest-leverage work is usually in `market/`, `strategy/`, `portfolio/rebalance`, and the docs/examples around those modules.

## Development

```bash
npm install
npm run build    # compile TypeScript → dist/
npm test         # run tests
npm run ingest:init   # backfill price_observations from Yahoo
npm run ingest:daily  # refresh latest daily bars
npm run backtest:smoke -- --linkId <strategy-link-id>
```

## Contributing Locally

Most contributors only need the default local workflow:

```bash
git clone https://github.com/livefolio/sdk.git
cd sdk
npm install
npm run build
npm test
```

The test suite mocks Supabase at the boundary, so most SDK work does not require a running backend.

If you are working on market ingestion, DB-backed backtests, or cache-through evaluation flows, set local Supabase credentials first:

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=<local-anon-key>
export SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```

Then you can run the data-backed workflows:

```bash
npm run ingest:init
npm run ingest:daily
npm run backtest:smoke -- --linkId <strategy-link-id>
```

Contributor expectations:

- Run `npm run build` and `npm test` before opening a PR
- Add unit tests for new exported behavior
- Update `docs/` when adding or changing public module methods
- Prefer narrow deterministic tests over large integration-only coverage

## Open Source Scope

The SDK is intended for developers building transparent, rules-based investing software. Community maintainers can use it to:

- Fetch market data and trading calendars
- Define, compile, evaluate, and stream rule-based strategies
- Run deterministic backtests over historical data
- Compute portfolio drift and generate rebalance plans
- Integrate Livefolio-compatible strategy definitions into custom apps and research workflows

PRs to `main` run build + tests and enforce a version bump. Merges auto-publish to npm.

## License

MIT
