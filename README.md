# @livefolio/sdk

TypeScript SDK for market data, strategy evaluation, and portfolio management.

## Install

```bash
npm install @livefolio/sdk
```

## Modules

- **market** — Market data retrieval and processing
- **evaluator** — Strategy allocation, indicators, signals, and backtesting
- **portfolio** — Brokerage account aggregation and trade order management

```ts
import { market, evaluator, portfolio } from '@livefolio/sdk';

// or import individual modules
import { ... } from '@livefolio/sdk/market';
import { ... } from '@livefolio/sdk/evaluator';
import { ... } from '@livefolio/sdk/portfolio';
```

## Development

```bash
npm install
npm run build
```

## License

MIT
