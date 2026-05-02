// contract-shape.ts — Minimal dialect skeleton.
// Shows the SHAPE of a dialect: a Spec type + fromMyDialectSpec hydrator that
// returns a Strategy<F>. The strategy is intentionally degenerate (always
// returns 100 % cash — no orders). The point is the structure, not behavior.
//
//   npx tsx scripts/docs/guides-dialect/contract-shape.ts

import type { Asset, AssetId } from '@livefolio/sdk';
import type { Strategy, Features } from '@livefolio/sdk';
import type { Portfolio } from '@livefolio/sdk';
import type { Order } from '@livefolio/sdk';
import type { AssetRef } from '@livefolio/sdk';

// ─── 1. Spec type ─────────────────────────────────────────────────────────────
//
// Plain data — no methods, no closures, safe to serialize as JSON.
// The `kind` string is the dialect identifier. Follow the <family>/<version>
// convention established by 'tactical/v1'.

type MyDialectSpec = {
  /** Dialect identifier. Stable once the first spec is stored. */
  kind: 'mydialect/v1';
  /**
   * The one required field for this minimal example.
   * A real dialect would add universe, weights, rules, etc.
   */
  universe: AssetRef[];
};

// ─── 2. Features type ─────────────────────────────────────────────────────────
//
// What the features() method produces and build() consumes.
// The generic param F links the two — TypeScript verifies they match.

type MyFeatures = {
  /** Most-recent close prices, keyed by AssetId. */
  prices: ReadonlyMap<AssetId, number>;
} & Features;

// ─── 3. Validation ────────────────────────────────────────────────────────────
//
// Call at the top of the hydrator so bad specs fail early with a clear message.
// Prefix error messages with the dialect identifier so callers know the source.

function validate(spec: MyDialectSpec): void {
  if (spec.universe.length === 0) {
    throw new Error('mydialect/v1: universe must contain at least one asset');
  }
  const seen = new Set<AssetId>();
  for (const asset of spec.universe) {
    if (seen.has(asset.id)) {
      throw new Error(`mydialect/v1: duplicate asset id "${asset.id}" in universe`);
    }
    seen.add(asset.id);
  }
}

// ─── 4. Hydrator ──────────────────────────────────────────────────────────────
//
// Turns a MyDialectSpec into a runnable Strategy<MyFeatures>.
// Runtime deps (calendar, data feed, etc.) are passed as a second argument.
// This hydrator is degenerate: build() always returns [] (hold 100 % cash).
// That is intentional — the goal is to demonstrate the contract, not a strategy.

export function fromMyDialectSpec(spec: MyDialectSpec): Strategy<MyFeatures> {
  validate(spec);

  // Derive Asset descriptors from the spec once at hydration time.
  const universe: ReadonlyArray<Asset> = spec.universe.map((ref) => ({
    kind: 'equity' as const,
    id: ref.id,
    symbol: ref.symbol,
    ...(ref.exchange !== undefined ? { exchange: ref.exchange } : {}),
  }));

  return {
    // universe() — synchronous, cheap. Returns the same set every session.
    universe(_t: Date, _portfolio: Portfolio): ReadonlyArray<Asset> {
      return universe;
    },

    // features() — async, all data fetching happens here.
    // Returns MyFeatures, which is what build() will receive.
    async features(_universe: ReadonlyArray<Asset>, _portfolio: Portfolio, _t: Date): Promise<MyFeatures> {
      // Degenerate implementation: return empty prices.
      // A real dialect would fetch prices from DataFeed here.
      return { prices: new Map<AssetId, number>() };
    },

    // build() — synchronous. Translates features into orders.
    // Returning [] means "hold current positions unchanged" (100 % cash here).
    build(_features: MyFeatures, _portfolio: Portfolio, _t: Date): ReadonlyArray<Order> {
      return [];
    },
  };
}

// ─── Demo ─────────────────────────────────────────────────────────────────────

const spec: MyDialectSpec = {
  kind: 'mydialect/v1',
  universe: [
    { id: 'us:SPY', symbol: 'SPY' },
    { id: 'us:IEF', symbol: 'IEF' },
  ],
};

const strategy = fromMyDialectSpec(spec);

// Verify the contract: all three methods are present and callable.
const now = new Date('2024-01-15T00:00:00Z');
const emptyPortfolio: Portfolio = { cash: 100_000, positions: [], t: now };

const u = strategy.universe(now, emptyPortfolio);
console.log(`universe() → ${u.length} assets: ${u.map((a) => a.symbol).join(', ')}`);

const f = await strategy.features(u, emptyPortfolio, now);
console.log(`features() → prices map has ${f.prices.size} entries`);

const orders = strategy.build(f, emptyPortfolio, now);
console.log(`build()    → ${orders.length} orders (degenerate: always 0)`);

console.log('\nContract verified. The dialect shape is correct.');
console.log('See dialect-contract.md for what a real hydrator fills in.');
