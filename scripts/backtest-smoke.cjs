#!/usr/bin/env node
/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');
const { createLivefolioClient } = require('../dist/index.js');

function parseArg(name, fallback = null) {
  const prefixed = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefixed)) return arg.slice(prefixed.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

async function main() {
  const linkId = parseArg('linkId', process.env.STRATEGY_LINK_ID);
  const startDate = parseArg('startDate', process.env.START_DATE || '2024-01-01');
  const endDate = parseArg('endDate', process.env.END_DATE || '2024-12-31');
  const initialCapitalArg = parseArg('initialCapital', process.env.INITIAL_CAPITAL || '100000');
  const initialCapital = Number(initialCapitalArg);

  if (!linkId) throw new Error('Provide --linkId or STRATEGY_LINK_ID.');

  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  }

  const supabase = createClient(supabaseUrl, key);
  const livefolio = createLivefolioClient(supabase);

  const strategy = await livefolio.strategy.get(linkId);
  if (!strategy) throw new Error(`No strategy found for linkId: ${linkId}`);

  const result = await livefolio.strategy.backtest(strategy, {
    startDate,
    endDate,
    initialCapital: Number.isFinite(initialCapital) ? initialCapital : 100000,
  });

  console.log(JSON.stringify(result.summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
