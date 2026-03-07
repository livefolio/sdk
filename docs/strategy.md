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

### `stream(strategy, observation): Promise<StrategyEvaluation>`

Live streaming evaluation. Accepts a single `StreamObservation` or an array. Merges observations into historical series (replacing same-date bars or appending), then evaluates.

```ts
const result = await lf.strategy.stream(strategy, [
  { symbol: 'SPY', timestamp: '2025-06-01T16:00:00Z', value: 590.25 },
  { symbol: 'QQQ', timestamp: '2025-06-01T16:00:00Z', value: 480.10 },
]);
// → same shape as evaluate(): { asOf, allocation, signals, indicators }
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

### `backtest(strategy, options): Promise<BacktestResult>`

Runs a deterministic, rules-based backtest using DB-only historical series (`price_observations`) and `trading_days`.

Requirements:
- Strategy must include exactly one allocation named `Default`.
- Backtest evaluates allocations by strategy order; first match wins; `Default` is fallback.
