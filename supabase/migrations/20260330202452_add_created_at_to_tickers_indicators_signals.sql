alter table tickers add column created_at timestamptz default now() not null;
alter table indicators add column created_at timestamptz default now() not null;
alter table signals add column created_at timestamptz default now() not null;
