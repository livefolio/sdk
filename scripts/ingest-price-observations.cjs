#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function parseArg(name, fallback = null) {
  const prefixed = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefixed)) return arg.slice(prefixed.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function loadTrackedTickers() {
  const filePath = path.resolve(__dirname, '../src/market/trackedTickers.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const symbols = [];
  for (const match of source.matchAll(/'([^']+)'/g)) {
    const symbol = match[1];
    if (symbol === 'TrackedTicker') continue;
    symbols.push(symbol);
  }
  return [...new Set(symbols)];
}

function isoDay(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function isoTs(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString();
}

async function fetchYahooChart(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=${encodeURIComponent(range)}&interval=1d&includePrePost=false&events=div%2Csplits`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'livefolio-ingestion/1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const rows = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const ts = timestamps[index];
    const close = closes[index];
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    rows.push({
      symbol,
      date: isoDay(ts),
      price_330pm_et: close,
      price_400pm_et: close,
      timestamp_330pm_et: isoTs(ts),
      timestamp_400pm_et: isoTs(ts),
    });
  }

  return rows;
}

async function upsertRows(supabase, rows) {
  const chunkSize = 1000;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase
      .from('price_observations')
      .upsert(chunk, { onConflict: 'symbol,date' });
    if (error) throw new Error(error.message);
  }
}

async function main() {
  const mode = (parseArg('mode', 'init') || 'init').toLowerCase();
  const symbolsArg = parseArg('symbols', '');
  const limitArg = parseArg('limit', '');
  const symbols = symbolsArg
    ? [...new Set(symbolsArg.split(',').map((value) => value.trim()).filter(Boolean))]
    : loadTrackedTickers();
  const limit = limitArg ? Number(limitArg) : null;
  const selected = Number.isFinite(limit) && limit > 0 ? symbols.slice(0, limit) : symbols;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).');
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const range = mode === 'daily' ? '5d' : 'max';
  let totalRows = 0;
  let success = 0;
  let failed = 0;

  console.log(`Starting ${mode} ingestion for ${selected.length} symbols (range=${range})`);

  for (const symbol of selected) {
    try {
      const rows = await fetchYahooChart(symbol, range);
      if (rows.length === 0) {
        console.log(`- ${symbol}: no rows`);
        continue;
      }
      const payload = mode === 'daily' ? [rows[rows.length - 1]] : rows;
      await upsertRows(supabase, payload);
      totalRows += payload.length;
      success += 1;
      console.log(`- ${symbol}: upserted ${payload.length}`);
    } catch (error) {
      failed += 1;
      console.log(`- ${symbol}: failed (${error.message})`);
    }
  }

  console.log(`Done. success=${success} failed=${failed} rows_upserted=${totalRows}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
