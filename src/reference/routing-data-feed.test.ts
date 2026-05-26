import { describe, it, expect, vi } from 'vitest';
import { RoutingDataFeed, RoutingDataFeedError } from './routing-data-feed';
import type { Asset, Bar, DateRange, DividendEvent } from '../interfaces/types';
import type { DataFeed, Fundamentals } from '../interfaces/data-feed';

const equity: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
const macro: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };
const range: DateRange = { from: new Date('2024-01-01'), to: new Date('2024-12-31') };

function makeFeed(overrides: Partial<DataFeed> = {}): DataFeed {
  // Default feed: empty bars stream, no fundamentals method.
  return {
    bars: vi.fn(async function* () {
      // empty
    }),
    ...overrides,
  };
}

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('RoutingDataFeed', () => {
  it('routes bars by asset.kind via map form', async () => {
    const yahoo = makeFeed();
    const fred = makeFeed();
    const router = new RoutingDataFeed({ equity: yahoo, macro: fred });

    await drain(router.bars(equity, range, '1d'));
    await drain(router.bars(macro, range, '1d'));

    expect(yahoo.bars).toHaveBeenCalledWith(equity, range, '1d', undefined);
    expect(fred.bars).toHaveBeenCalledWith(macro, range, '1d', undefined);
    expect(yahoo.bars).toHaveBeenCalledTimes(1);
    expect(fred.bars).toHaveBeenCalledTimes(1);
  });

  it('routes via function form', async () => {
    const yahoo = makeFeed();
    const fred = makeFeed();
    const router = new RoutingDataFeed((a) => (a.kind === 'macro' ? fred : yahoo));

    await drain(router.bars(equity, range, '1d'));
    await drain(router.bars(macro, range, '1d'));

    expect(yahoo.bars).toHaveBeenCalledTimes(1);
    expect(fred.bars).toHaveBeenCalledTimes(1);
  });

  it('forwards range and freq unchanged', async () => {
    const feed = makeFeed();
    const router = new RoutingDataFeed({ equity: feed });
    await drain(router.bars(equity, range, '1h'));
    expect(feed.bars).toHaveBeenCalledWith(equity, range, '1h', undefined);
  });

  it('yields bars in the order the inner feed yields them', async () => {
    const bars: Bar[] = [
      { t: new Date('2024-01-02'), open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { t: new Date('2024-01-03'), open: 2, high: 2, low: 2, close: 2, volume: 0 },
    ];
    const feed = makeFeed({
      bars: vi.fn(async function* () {
        for (const b of bars) yield b;
      }),
    });
    const router = new RoutingDataFeed({ equity: feed });
    expect(await drain(router.bars(equity, range, '1d'))).toEqual(bars);
  });

  it('routes fundamentals by asset.kind', async () => {
    const fundamentals: Fundamentals = { peRatio: 28.5 };
    const yahoo = makeFeed({ fundamentals: vi.fn(async () => fundamentals) });
    const router = new RoutingDataFeed({ equity: yahoo });
    const t = new Date('2024-06-01');
    expect(await router.fundamentals(equity, t)).toEqual(fundamentals);
    expect(yahoo.fundamentals).toHaveBeenCalledWith(equity, t);
  });

  it('throws RoutingDataFeedError when routed feed lacks fundamentals', async () => {
    const fred = makeFeed(); // no fundamentals method
    const router = new RoutingDataFeed({ macro: fred });
    await expect(router.fundamentals(macro, new Date())).rejects.toThrow(RoutingDataFeedError);
    await expect(router.fundamentals(macro, new Date())).rejects.toThrow(/does not implement fundamentals/);
  });

  it('throws RoutingDataFeedError on unknown asset.kind (map form)', async () => {
    const router = new RoutingDataFeed({ equity: makeFeed() });
    await expect(drain(router.bars(macro, range, '1d'))).rejects.toThrow(RoutingDataFeedError);
    await expect(drain(router.bars(macro, range, '1d'))).rejects.toThrow(
      /no feed registered.*kind="macro".*id="DGS10"/,
    );
  });

  it('throws RoutingDataFeedError when function form returns undefined', async () => {
    const router = new RoutingDataFeed(() => undefined);
    await expect(drain(router.bars(equity, range, '1d'))).rejects.toThrow(RoutingDataFeedError);
    await expect(drain(router.bars(equity, range, '1d'))).rejects.toThrow(
      /no feed registered.*kind="equity".*id="AAPL"/,
    );
  });

  it('routes dividends to a feed that implements it', async () => {
    const divs: DividendEvent[] = [
      {
        asset: equity,
        exDate: new Date('2024-03-08'),
        payDate: new Date('2024-03-15'),
        amountPerShare: 0.24,
        incomeKind: 'qualified-eligible',
      },
    ];
    const yahoo = makeFeed({ dividends: vi.fn(async () => divs) });
    const router = new RoutingDataFeed({ equity: yahoo });
    expect(await router.dividends(equity, range)).toEqual(divs);
    expect(yahoo.dividends).toHaveBeenCalledWith(equity, range);
  });

  it('throws RoutingDataFeedError when routed feed lacks dividends', async () => {
    const fred = makeFeed(); // no dividends method
    const router = new RoutingDataFeed({ macro: fred });
    await expect(router.dividends(macro, range)).rejects.toThrow(RoutingDataFeedError);
    await expect(router.dividends(macro, range)).rejects.toThrow(/does not implement dividends/);
  });

  it('does not implement events', () => {
    const router = new RoutingDataFeed({ equity: makeFeed() });
    expect('events' in router).toBe(false);
  });

  it('forwards the bars kind discriminator to the routed feed', async () => {
    const feed: DataFeed = {
      async *bars(_a, _r, _f, kind) {
        yield { t: new Date('2024-01-02'), open: 0, high: 0, low: 0, close: kind === 'unadjusted' ? 100 : 95, volume: 0 };
      },
    };
    const router = new RoutingDataFeed({ equity: feed });
    const asset: Asset = { kind: 'equity', id: 'SPY', symbol: 'SPY' };
    const r: DateRange = { from: new Date('2024-01-01'), to: new Date('2024-02-01') };
    const collect = async (k?: 'adjusted' | 'unadjusted'): Promise<number[]> => {
      const out: number[] = [];
      for await (const b of router.bars(asset, r, '1d', k)) out.push(b.close);
      return out;
    };
    expect(await collect('unadjusted')).toEqual([100]);
    expect(await collect('adjusted')).toEqual([95]);
    expect(await collect()).toEqual([95]); // default = adjusted
  });
});
