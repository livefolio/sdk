# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
npm run build    # compile TypeScript (tsc) → dist/
npm run clean    # remove dist/
```

No linter, formatter, or test runner is configured yet.

## Architecture

`@livefolio/sdk` is a TypeScript SDK with three domain modules:

- **market** — Market data retrieval and processing
- **evaluator** — Strategy allocation evaluation, indicators, signals, and backtesting
- **portfolio** — Brokerage account aggregation and trade order management

### Module pattern

Each module lives in `src/<module>/index.ts` and is re-exported as a namespace from `src/index.ts`:

```ts
export * as market from './market';
```

Consumers can import the full SDK or individual modules via the package.json `exports` map:

```ts
import { market } from '@livefolio/sdk';
import { ... } from '@livefolio/sdk/market';
```

### Build output

TypeScript compiles to CommonJS (`dist/`) with declarations, declaration maps, and source maps. Target is ES2022. Strict mode is enabled.
