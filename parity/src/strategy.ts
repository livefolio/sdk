import type { LivefolioClient } from './v3/client';
import type { StrategyHandle } from './v3/handles/strategy';
import type { TacticalSpec, AssetRef } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

export const PARITY_RANGE_V3 = { from: '2020-06-01', to: '2026-05-02' } as const;
export const PARITY_RANGE = { from: utc('2020-06-01'), to: utc('2026-05-02') };

export const SPY_REF: AssetRef = { id: 'us:SPY', symbol: 'SPY' };
export const QQQ_REF: AssetRef = { id: 'us:QQQ', symbol: 'QQQ' };
export const IEF_REF: AssetRef = { id: 'us:IEF', symbol: 'IEF' };

/**
 * Canonical v0.3 strategy for the v0.4 parity gate.
 *
 * Semantics: Weekly rebalance. When SPY price > SMA(SPY, 200): hold 60% SPY /
 * 40% QQQ. Otherwise: hold 100% IEF. No hysteresis (tolerance = 0).
 *
 * Three tickers + one signal-driven branch satisfies the parity-case
 * requirements in docs/specs/2026-04-29-v0.4-multi-repo-interface-design.md.
 */
export function buildV3Strategy(client: LivefolioClient): StrategyHandle {
  const spy = client.ticker('SPY');
  const qqq = client.ticker('QQQ');
  const ief = client.ticker('IEF');

  const spyPrice = client.price(spy);
  const spySma200 = client.sma(spy, 200);

  const trend = client.gt(spyPrice, spySma200);

  const aggressive = client.allocation([spy, 0.6], [qqq, 0.4]);
  const defensive = client.allocation([ief, 1.0]);

  return client.strategy({
    name: 'v0.4-parity',
    freq: 'Weekly',
    offset: 0,
    rules: [{ when: [trend], hold: aggressive }, { hold: defensive }],
  });
}

/**
 * v0.4 spec equivalent of `buildV3Strategy`. Hand-derived 1:1 from the v0.3
 * fluent calls above. The codemod (phase 6) will produce specs of this shape
 * mechanically.
 */
export const PARITY_SPEC: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY_REF, QQQ_REF, IEF_REF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY_REF },
    { id: 'spy_sma200', kind: 'sma', asset: SPY_REF, period: 200 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
    then: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};
