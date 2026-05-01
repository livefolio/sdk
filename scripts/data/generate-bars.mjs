// Generates synthetic OHLCV CSVs for the v0.4 demo.
// Deterministic seeded random walk. Run: `node scripts/data/generate-bars.mjs`

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Mulberry32 PRNG — small, seedable, deterministic.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isWeekend(d) {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function* sessions(from, to) {
  const d = new Date(from);
  while (d < to) {
    if (!isWeekend(d)) yield new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

function generate({ symbol, start, drift, vol, seed, from, to }) {
  const r = rng(seed);
  let close = start;
  const rows = ['date,open,high,low,close,volume'];
  for (const t of sessions(from, to)) {
    // Daily log-return = drift + vol * z, where z ~ N(0,1) approximated from two uniforms.
    const u1 = r(),
      u2 = r();
    const z = Math.sqrt(-2 * Math.log(u1 || 1e-9)) * Math.cos(2 * Math.PI * u2);
    const ret = drift + vol * z;
    const open = close;
    close = open * Math.exp(ret);
    const high = Math.max(open, close) * (1 + 0.003 * r());
    const low = Math.min(open, close) * (1 - 0.003 * r());
    const volume = Math.round(50_000_000 + 30_000_000 * r());
    const date = t.toISOString().slice(0, 10);
    rows.push(
      `${date},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},${volume}`,
    );
  }
  writeFileSync(join(here, `${symbol}.csv`), rows.join('\n') + '\n');
  console.log(`wrote ${symbol}.csv (${rows.length - 1} bars)`);
}

const FROM = new Date('2025-01-02T00:00:00Z');
const TO = new Date('2025-04-01T00:00:00Z');

generate({ symbol: 'SPY', start: 600, drift: 0.0004, vol: 0.011, seed: 0xc0ffee, from: FROM, to: TO });
generate({ symbol: 'AGG', start: 100, drift: 0.0001, vol: 0.003, seed: 0xbeef, from: FROM, to: TO });
