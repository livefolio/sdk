# Market Ingestion Plan

This workflow keeps backtests deterministic by loading historical data into Supabase first, then reading only from the database.

## 1) Initial backfill

1. Seed tracked symbols from `TRACKED_TICKERS_YFINANCE`.
2. Download daily bars from Yahoo Finance for each symbol.
3. Upsert into `price_observations` keyed by `(symbol, date)`.

Suggested table for explicit ingestion scope:

```sql
create table if not exists tracked_tickers (
  symbol text primary key,
  enabled boolean not null default true,
  source text not null default 'yfinance',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 2) Daily cron refresh

Run once per market day after close:

1. Read enabled symbols from `tracked_tickers`.
2. Fetch latest daily bar from Yahoo Finance.
3. Upsert new/changed `price_observations` rows.

Example cron: `15 21 * * 1-5` (9:15 PM UTC) to run after US market close.

## 3) Backtest read path

- Use `market.getBatchSeriesFromDb(symbols, startDate, endDate)`.
- Use `market.getTradingDays(startDate, endDate)`.
- Do not use cache-through fetches during backtest execution.
