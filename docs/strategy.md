# Strategy Module

Strategy retrieval, evaluation, and live streaming.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `get(linkId): Promise<Strategy | null>`

Fetch a strategy definition by link ID.

```ts
const strategy = await lf.strategy.get('bCicNI7OI2x');
// → { linkId: 'bCicNI7OI2x', name: 'Tactical Allocation', signals: [...], allocations: [...], ... }
```

### `getMany(linkIds): Promise<Record<string, Strategy>>`

Fetch multiple strategies. Missing IDs are omitted from the result.

```ts
const strategies = await lf.strategy.getMany(['abc123', 'def456']);
// → { abc123: { linkId: 'abc123', name: '...', ... } }  (missing IDs omitted)
```

### `evaluate(strategy, at): Promise<StrategyEvaluation>`

Cache-through evaluation. Fetches series, checks cache, evaluates on miss. Returns the active allocation, signal states, and indicator values.

```ts
const result = await lf.strategy.evaluate(strategy, new Date());
// → {
//     asOf: 2025-06-01T21:00:00.000Z,
//     allocation: { name: 'Risk On', holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 0.6 }, ...] },
//     signals: { 'SMA > EMA': true, 'VIX < 20': false },
//     indicators: { 'SPY SMA 200': { timestamp: '...', value: 540.12 }, ... }
//   }
```

### `extractSymbols(strategy): string[]`

Return all unique ticker symbols referenced by a strategy.

```ts
const symbols = lf.strategy.extractSymbols(strategy);
console.log(symbols); // ['SPY', 'QQQ', 'TLT']
```

### `createStreamer(strategy): Promise<Streamer>`

Creates a stateful `Streamer` that fetches series and prior state once, then evaluates synchronously on each `update()` call. State carries forward between updates (signal hysteresis).

```ts
const streamer = await lf.strategy.createStreamer(strategy);

const result = streamer.update([
  { symbol: 'SPY', timestamp: '2025-06-01T16:00:00Z', value: 590.25 },
  { symbol: 'QQQ', timestamp: '2025-06-01T16:00:00Z', value: 480.10 },
]);
// → same shape as evaluate(): { asOf, allocation, signals, indicators }

// Subsequent calls are synchronous — no network round-trips
const result2 = streamer.update({ symbol: 'SPY', timestamp: '2025-06-01T16:01:00Z', value: 591.00 });
```

### Pure evaluation

Synchronous, no DB — for testing or advanced use:

```ts
const indicator = strategy.signals[0].lhs;
lf.strategy.evaluateIndicator(indicator, { at, batchSeries });
// → { timestamp: '2025-06-01T21:00:00Z', value: 540.12 }

lf.strategy.evaluateSignal(strategy.signals[0], { at, batchSeries });
// → true

lf.strategy.evaluateAllocation(strategy.allocations[0], { at, batchSeries });
// → true (condition met)

lf.strategy.getEvaluationDate(strategy.trading, { at, batchSeries });
// → 2025-06-01T21:00:00.000Z
```

### `backtest(strategy, options): Promise<BacktestResult>` *(stub)*
