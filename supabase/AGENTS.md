<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# supabase

## Purpose
Supabase project configuration, database schema definitions, migrations, and seed data. Defines the relational model backing the SDK's handle system.

## Key Files

| File | Description |
|------|-------------|
| `config.toml` | Supabase CLI project configuration |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `migrations/` | Timestamped SQL migrations applied in order |
| `schemas/` | Numbered reference schema files (canonical table definitions) |
| `seeds/` | Seed data (trading days calendar) |
| `snippets/` | Ad-hoc SQL snippets (currently empty) |

## For AI Agents

### Working In This Directory
- **Do not modify migrations after they have been applied** — create new migrations instead
- Schema files in `schemas/` are reference copies — migrations are the source of truth for the database state
- The database has RLS enabled with public read access (see migration `20260330193341`)
- All tables use `created_at` timestamps

### Database Schema Overview
The tables form a dependency chain:
1. `trading_days` — Calendar of US market trading days with open/close times
2. `tickers` — Unique (symbol, leverage) pairs
3. `indicators` — Technical indicator definitions, referencing tickers
4. `indicators_series` — Daily indicator values, keyed by (indicator_id, trading_day_id)
5. `signals` — Comparison rules between two indicators
6. `signals_series` — Daily boolean signal values
7. `allocations` — Weighted holdings (JSON array of ticker/weight pairs)
8. `strategies` — Named rule sets mapping signals to allocations
9. `strategies_series` — Daily strategy allocation decisions

### Testing Requirements
- Use `supabase db reset` to apply all migrations and seeds locally
- Verify new migrations with `supabase db diff` before committing

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
