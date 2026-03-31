# @livefolio/sdk

TypeScript SDK for building and backtesting trading strategies. Provides lazy handles for tickers and indicators that automatically fetch market data from Yahoo Finance and FRED, compute derived indicators, and cache results in a Supabase database.

## Install

```bash
npm install @livefolio/sdk @supabase/supabase-js
```

## Quick Start

```ts
import { createClient } from '@livefolio/sdk';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_KEY);

const sdk = createClient({
  supabase,
  fredApiKey: 'your-fred-api-key', // optional, required for treasury indicators
});

const spy = sdk.ticker('SPY');
const sma200 = sdk.sma(spy, 200);

// First call fetches SPY prices from Yahoo Finance, computes the 200-day SMA,
// stores everything in the database, and returns the result.
// Subsequent calls return cached data instantly.
const series = await sma200.series();
const latest = await sma200.value();
```

## Concepts

### Lazy Handles

Everything in the SDK is a **lazy handle** -- a lightweight object that describes *what* you want without hitting the database or any external API. Data is only fetched when you call `.series()` or `.value()`.

```ts
const spy = sdk.ticker('SPY');           // no DB call
const sma200 = sdk.sma(spy, 200);       // no DB call
const series = await sma200.series();    // NOW: resolve -> fetch -> compute -> return
```

### Automatic Sync

Indicator series data is fetched and computed transparently. When you call `.series()` or `.value()`:

1. The indicator and its dependencies are resolved (upserted) in the database
2. If the series is stale or missing, raw data is fetched from the appropriate source
3. Derived indicators are computed from their dependencies
4. Results are upserted to the database and cached in memory

Since market data is daily closing prices, data is immutable once the trading day closes. The SDK takes advantage of this for aggressive caching.

## API Reference

### `createClient(options)`

```ts
createClient({
  supabase: SupabaseClient,  // required
  fredApiKey?: string,       // required for treasury indicators
})
```

Returns a `LivefolioClient` with the factory methods below.

### Tickers

```ts
sdk.ticker(symbol: string, leverage?: number)
```

Creates a `TickerHandle`. Leverage defaults to `1`.

```ts
const spy = sdk.ticker('SPY');
const spxl = sdk.ticker('SPXL', 3);
```

### Ticker-Bound Indicators

These require a `TickerHandle` and compute from that ticker's price history.

```ts
sdk.sma(ticker, lookback, opts?)         // Simple Moving Average
sdk.ema(ticker, lookback, opts?)         // Exponential Moving Average
sdk.rsi(ticker, lookback, opts?)         // Relative Strength Index
sdk.price(ticker, opts?)                 // Raw closing price
sdk.returns(ticker, lookback, opts?)     // Period returns
sdk.volatility(ticker, lookback, opts?)  // Rolling standard deviation
sdk.drawdown(ticker, lookback, opts?)    // Drawdown from rolling max
```

`opts` is `{ delay?: number }` -- defaults to `0`.

```ts
const spy = sdk.ticker('SPY');
const sma200 = sdk.sma(spy, 200);
const rsi14 = sdk.rsi(spy, 14);
const delayed = sdk.sma(spy, 50, { delay: 1 });
```

### Standalone Indicators

No ticker required. Data comes directly from external APIs.

```ts
sdk.vix(opts?)                           // CBOE Volatility Index
sdk.vix3m(opts?)                         // CBOE 3-Month Volatility Index
sdk.treasury(tenor, opts?)               // Treasury rates (requires fredApiKey)
sdk.calendar(period, opts?)              // Date components from trading calendar
sdk.threshold(value, unit?)              // Constant value
```

Treasury tenors: `'T3M'`, `'T6M'`, `'T1Y'`, `'T2Y'`, `'T3Y'`, `'T5Y'`, `'T7Y'`, `'T10Y'`, `'T20Y'`, `'T30Y'`

Calendar periods: `'Month'`, `'Day of Week'`, `'Day of Month'`, `'Day of Year'`

Threshold units: `'%'`, `'$'`, or omit for unitless.

```ts
const vix = sdk.vix();
const t10y = sdk.treasury('T10Y');
const month = sdk.calendar('Month');
const half = sdk.threshold(0.5);
```

### Signals

Compare two indicators to create a boolean signal. Supports hysteresis via tolerance to reduce whipsawing.

```ts
sdk.gt(ind1, ind2, tolerance?)    // ind1 > ind2
sdk.lt(ind1, ind2, tolerance?)    // ind1 < ind2
sdk.eq(ind1, ind2, tolerance?)    // ind1 within tolerance range of ind2
```

Tolerance defaults to `0` (no hysteresis). When set, a buffer zone prevents the signal from flipping until the indicator moves fully through the buffer.

- **Relative tolerance** (Price, SMA, EMA, RSI, Threshold, Calendar): buffer = `ind2 * (1 +/- tolerance/100)`
- **Absolute tolerance** (Return, Volatility, Drawdown, VIX, VIX3M, Treasury): buffer = `ind2 +/- tolerance`

```ts
const spy = sdk.ticker('SPY');
const price = sdk.price(spy);
const sma200 = sdk.sma(spy, 200);

const bullish = sdk.gt(price, sma200, 5);    // 5% tolerance

const series = await bullish.series();         // DailyBar[] with value 0 or 1
const current = await bullish.value();         // 0 or 1
```

Signal handles support the same `.series(range?)`, `.value(date?)`, and `.resolve()` methods as indicator handles. Data is automatically synced -- both underlying indicators are refreshed before computing the signal.

### Allocations

Define portfolio holdings as weighted ticker pairs.

```ts
sdk.allocation(...holdings: [TickerHandle, number][])
```

Weights must sum to 1. Allocations are deduplicated by holdings -- creating the same allocation twice returns the same database row.

```ts
const aggressive = sdk.allocation([spy, 0.75], [gld, 0.25]);
const defensive = sdk.allocation([shy, 1.0]);
```

### Strategies

Compose signals and allocations into a priority-ordered rule list evaluated on a rebalancing schedule.

```ts
// Create a new strategy
sdk.strategy(options: StrategyOptions)

// Reference an existing strategy by link ID
sdk.strategy(linkId: string)
```

Each rule's `when` array is AND-ed together. OR is expressed by having multiple rules point to the same allocation. The last rule must be a fallback with no `when` clause. Rules are evaluated top-to-bottom; first match wins.

```ts
const spy = sdk.ticker('SPY');
const shy = sdk.ticker('SHY');
const price = sdk.price(spy);
const sma200 = sdk.sma(spy, 200);

const bullish = sdk.gt(price, sma200, 5);

const aggressive = sdk.allocation([spy, 1.0]);
const defensive = sdk.allocation([shy, 1.0]);

const strategy = sdk.strategy({
  name: 'Tactical SPY/SHY',
  freq: 'Monthly',       // rebalance on last trading day of each month
  offset: 0,             // positive = earlier, negative = later
  rules: [
    { when: [bullish], hold: aggressive },
    { hold: defensive },  // fallback
  ],
});

const history = await strategy.series();
// StrategyBar[] — { date: string, allocation: AllocationHandle }

const current = await strategy.value();
// AllocationHandle for the latest trading day
```

Trading frequencies: `'Daily'`, `'Weekly'`, `'Monthly'`, `'Bi-monthly'`, `'Quarterly'`, `'Every 4 Months'`, `'Semiannually'`, `'Yearly'`.

Strategy series are **dense** -- one row per trading day. On rebalance dates the rules are evaluated; on other days the previous allocation carries forward.

Each strategy gets a unique `link_id` (nanoid) on creation. Reference an existing strategy by its link ID to reload it without recreating.

### Simulation

Run a portfolio simulation over a date range. Returns a `SimulationHandle` with the equity curve and trade history.

```ts
const sim = await strategy.simulate({ from: '2020-01-01', to: '2025-12-31', initialCapital: 100_000 });

sim.series         // DailyBar[] — portfolio value per trading day
sim.trades         // Trade[]   — every buy/sell event
sim.initialCapital // number    — starting capital
```

The simulator rebalances at the strategy's `freq` cadence, fetches price data for all tickers in all allocations automatically, and tracks positions and cash through each trading day.

```ts
interface Trade {
  date: string;
  symbol: string;
  quantity: number;       // number of shares traded
  price: number;
  action: 'buy' | 'sell';
}
```

Agents compute whatever derived metrics they need (CAGR, Sharpe, drawdown, etc.) from the raw data:

```ts
const values = sim.series.map(b => b.value);
const dailyReturns = values.slice(1).map((v, i) => (v - values[i]) / values[i]);
```

### Handle Methods

Every `IndicatorHandle`, `SignalHandle`, and `StrategyHandle` exposes:

#### `.series(range?)`

Returns the full time series. For indicators and signals this is `DailyBar[]`; for strategies it is `StrategyBar[]`.

```ts
interface DailyBar {
  date: string;  // 'YYYY-MM-DD'
  value: number;
}

interface StrategyBar {
  date: string;
  allocation: AllocationHandle;
}

const all = await sma200.series();
const subset = await sma200.series({ from: '2024-01-01', to: '2024-12-31' });
```

#### `.value(date?)`

Returns the latest value, or the value for a specific date. Returns `null` if no data exists. For strategies, returns `AllocationHandle | null`.

```ts
const latest = await sma200.value();
const specific = await sma200.value('2024-06-15');
```

#### `.resolve()`

Explicitly upserts the indicator to the database and returns the row. Normally you don't need to call this -- `.series()` and `.value()` call it automatically.

```ts
const row = await sma200.resolve();
console.log(row.id); // database ID
```

## Data Sources

| Indicator Type | Source |
|---|---|
| Price, VIX, VIX3M | Yahoo Finance |
| Treasury rates (T3M--T30Y) | FRED API |
| SMA, EMA, RSI, Returns, Volatility, Drawdown | Computed from Price |
| Calendar (Month, Day of Week, etc.) | Computed from trading days |
| Threshold | Constant (no external data) |

## Database

The SDK uses Supabase as its backing store. Schema files are in `supabase/schemas/`. Key tables:

- `trading_days` -- market calendar with session timestamps
- `tickers` -- symbols with leverage multiplier
- `indicators` -- indicator definitions (type, params, ticker reference)
- `indicators_series` -- daily indicator values linked to trading days
- `signals` -- signal definitions (two indicators, comparison, tolerance)
- `signals_series` -- daily boolean signal values linked to trading days
- `allocations` -- portfolio holdings as JSONB (deduplicated)
- `strategies` -- strategy definitions with rebalance frequency and rule JSONB
- `strategies_series` -- active allocation per trading day per strategy (dense)

Run `supabase db reset` to set up the local database from the schema and seed files.

## License

MIT
