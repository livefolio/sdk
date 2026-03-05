# Strategy Module

Strategy retrieval, evaluation, and live streaming.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `get(linkId): Promise<Strategy | null>`

Fetch a strategy definition by link ID.

### `getMany(linkIds): Promise<Record<string, Strategy>>`

Fetch multiple strategies. Missing IDs are omitted from the result.

### `evaluate(strategy, at): Promise<StrategyEvaluation>`

Cache-through evaluation. Fetches series, checks cache, evaluates on miss. Returns the active allocation, signal states, and indicator values.

### `extractSymbols(strategy): string[]`

Return all unique ticker symbols referenced by a strategy.

### `stream(strategy, observation): Promise<StrategyEvaluation>`

Live streaming evaluation. Accepts a single `StreamObservation` or an array. Merges observations into historical series (replacing same-date bars or appending), then evaluates.

```ts
await lf.strategy.stream(strategy, [
  { symbol: 'SPY', timestamp: '2025-06-01T16:00:00Z', value: 590.25 },
  { symbol: 'QQQ', timestamp: '2025-06-01T16:00:00Z', value: 480.10 },
]);
```

### Pure evaluation

Synchronous, no DB — for testing or advanced use:

- `evaluateIndicator(indicator, options): IndicatorEvaluation`
- `evaluateSignal(signal, options): boolean`
- `evaluateAllocation(allocation, options): boolean`
- `getEvaluationDate(trading, options): Date`

### `backtest(strategy, options): Promise<BacktestResult>` *(stub)*
