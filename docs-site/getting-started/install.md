# Installation

## Requirements

- **Node.js** >= 20
- **TypeScript** >= 5 (strict mode recommended)
- An ES module project (`"type": "module"` in `package.json` or `.mts` source files)

## Install

```bash
npm install @livefolio/sdk
```

`@livefolio/sdk` is the only package you need to author and backtest tactical strategies. It ships with reference implementations for all four runtime layers.

### Optional data adapters

The SDK's `DataFeed` interface is pluggable. To connect to real market data, install a companion adapter:

```bash
# Yahoo Finance (community-maintained)
npm install @livefolio/yfinance
```

You can also implement `DataFeed` directly against any source — see Custom DataFeed in the Guides section.

## ESM-only note

`@livefolio/sdk` is a pure ES module. CommonJS (`require(...)`) is not supported. If your project uses CommonJS, you must migrate to ESM or use a dynamic `import()` in an async context.

## TypeScript configuration

The SDK is authored with `strict: true` and `noUncheckedIndexedAccess: true`. For the best experience, enable at least `strict` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2022"
  }
}
```

`moduleResolution: "bundler"` (or `"node16"` / `"nodenext"`) is required to resolve extensionless imports correctly.

## Verify the installation

```bash
node -e "import('@livefolio/sdk').then(m => console.log(Object.keys(m).slice(0, 6)))"
```

Expected output (order may vary):

```
[ 'runBacktest', 'reconcile', 'fromSpec', 'MemoryFeatureCache', 'BacktestExecutor', 'NYSEExchangeCalendar' ]
```

## Next steps

- **[First strategy](/getting-started/first-strategy)** — build and run a complete SPY/QQQ/IEF backtest in under 120 lines.
- **[Concepts](/getting-started/concepts)** — understand the four-layer runtime stack.
