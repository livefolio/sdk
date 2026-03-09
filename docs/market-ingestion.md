# Market Ingestion Plan

Backtests read from Supabase (`price_observations`, `trading_days`). Data hydration is cache-through via the `series()` edge function: missing symbols/dates are fetched from Yahoo, then persisted.

## Prerequisites

Set local Supabase credentials:

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=<local-anon-key>
# Prefer service role for writes
export SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```

## 1) Cache-through hydration (default path)

Any consumer of market `series()` (for example strategy `evaluate`) can hydrate data:

1. Query requested symbols and date range.
2. For missing symbols or missing recent dates, fetch Yahoo daily bars.
3. Upsert new rows into `price_observations`.

This is the default ingestion path and does not require a separate backfill command.

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

## 2) Optional explicit prefetch

You can still prefetch tracked symbols (for faster first-run UX):

```bash
npm run ingest:init
```

Optional partial run:

```bash
node scripts/ingest-price-observations.cjs --mode init --limit 20
node scripts/ingest-price-observations.cjs --mode init --symbols SPY,QQQ,TQQQ
```

## 3) Daily cron refresh

Run once per market day after close:

1. Read enabled symbols from `tracked_tickers`.
2. Fetch latest daily bar from Yahoo Finance.
3. Upsert new/changed `price_observations` rows.

Example cron: `15 21 * * 1-5` (9:15 PM UTC) to run after US market close.

Manual daily refresh:

```bash
npm run ingest:daily
```

## 4) Backtest read path

- Use `market.getBatchSeriesFromDb(symbols, startDate, endDate)`.
- Use `market.getTradingDays(startDate, endDate)`.
- Do not use cache-through fetches during backtest execution.

## 5) Backtest smoke test

Build SDK, then run:

```bash
npm run build
node scripts/backtest-smoke.cjs --linkId <strategy-link-id> --startDate 2024-01-01 --endDate 2024-12-31
```
