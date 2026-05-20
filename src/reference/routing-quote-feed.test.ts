import { describe, it, expect, vi } from 'vitest';
import { RoutingQuoteFeed, RoutingQuoteFeedError } from './routing-quote-feed';
import type { Asset } from '../interfaces/types';
import type { QuoteFeed, Quote } from '../interfaces/quote-feed';

const aapl: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
const msft: Asset = { kind: 'equity', id: 'MSFT', symbol: 'MSFT' };
const dgs10: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y' };
const cpi: Asset = { kind: 'macro', id: 'CPIAUCSL', symbol: 'CPI' };

function makeQuoteFeed(overrides: Partial<QuoteFeed> = {}): QuoteFeed {
  return {
    quote: vi.fn(
      async (asset: Asset): Promise<Quote> => ({
        asset,
        t: new Date('2024-06-03T13:30:00Z'),
        price: 1,
      }),
    ),
    ...overrides,
  };
}

function makeBatchQuoteFeed(overrides: Partial<QuoteFeed> = {}): QuoteFeed {
  return {
    quote: vi.fn(
      async (asset: Asset): Promise<Quote> => ({
        asset,
        t: new Date('2024-06-03T13:30:00Z'),
        price: 1,
      }),
    ),
    quoteBatch: vi.fn(
      async (assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>> =>
        assets.map((asset) => ({ asset, t: new Date('2024-06-03T13:30:00Z'), price: 1 })),
    ),
    ...overrides,
  };
}

describe('RoutingQuoteFeed', () => {
  it('routes quote() by asset.kind via map form', async () => {
    const alpaca = makeQuoteFeed();
    const fred = makeQuoteFeed();
    const router = new RoutingQuoteFeed({ equity: alpaca, macro: fred });

    await router.quote(aapl);
    await router.quote(dgs10);

    expect(alpaca.quote).toHaveBeenCalledWith(aapl);
    expect(fred.quote).toHaveBeenCalledWith(dgs10);
    expect(alpaca.quote).toHaveBeenCalledTimes(1);
    expect(fred.quote).toHaveBeenCalledTimes(1);
  });

  it('routes quote() via function form', async () => {
    const alpaca = makeQuoteFeed();
    const fred = makeQuoteFeed();
    const router = new RoutingQuoteFeed((a) => (a.kind === 'macro' ? fred : alpaca));

    await router.quote(aapl);
    await router.quote(dgs10);

    expect(alpaca.quote).toHaveBeenCalledTimes(1);
    expect(fred.quote).toHaveBeenCalledTimes(1);
  });

  it('quote() throws RoutingQuoteFeedError on unknown asset.kind', async () => {
    const router = new RoutingQuoteFeed({ equity: makeQuoteFeed() });
    await expect(router.quote(dgs10)).rejects.toThrow(RoutingQuoteFeedError);
    await expect(router.quote(dgs10)).rejects.toThrow(/no feed registered.*kind="macro".*id="DGS10"/);
  });

  it('quote() throws when function form returns undefined', async () => {
    const router = new RoutingQuoteFeed(() => undefined);
    await expect(router.quote(aapl)).rejects.toThrow(RoutingQuoteFeedError);
  });

  it('quoteBatch([]) resolves to [] without route lookup', async () => {
    const route = vi.fn();
    const router = new RoutingQuoteFeed(route);
    expect(await router.quoteBatch([])).toEqual([]);
    expect(route).not.toHaveBeenCalled();
  });

  it('quoteBatch() preserves request order across routes', async () => {
    const alpaca = makeBatchQuoteFeed({
      quoteBatch: vi.fn(async (assets) => assets.map((asset) => ({ asset, t: new Date(), price: 100 }))),
    });
    const fred = makeBatchQuoteFeed({
      quoteBatch: vi.fn(async (assets) => assets.map((asset) => ({ asset, t: new Date(), price: 200 }))),
    });
    const router = new RoutingQuoteFeed({ equity: alpaca, macro: fred });

    const out = await router.quoteBatch([dgs10, aapl, msft, cpi]);

    expect(out).toHaveLength(4);
    expect(out[0]?.asset.id).toBe('DGS10');
    expect(out[0]?.price).toBe(200);
    expect(out[1]?.asset.id).toBe('AAPL');
    expect(out[1]?.price).toBe(100);
    expect(out[2]?.asset.id).toBe('MSFT');
    expect(out[2]?.price).toBe(100);
    expect(out[3]?.asset.id).toBe('CPIAUCSL');
    expect(out[3]?.price).toBe(200);
  });

  it('quoteBatch() calls each inner feed exactly once with its grouped assets', async () => {
    const alpaca = makeBatchQuoteFeed();
    const fred = makeBatchQuoteFeed();
    const router = new RoutingQuoteFeed({ equity: alpaca, macro: fred });

    await router.quoteBatch([aapl, dgs10, msft, cpi]);

    expect(alpaca.quoteBatch).toHaveBeenCalledTimes(1);
    expect(alpaca.quoteBatch).toHaveBeenCalledWith([aapl, msft]);
    expect(fred.quoteBatch).toHaveBeenCalledTimes(1);
    expect(fred.quoteBatch).toHaveBeenCalledWith([dgs10, cpi]);
  });

  it('quoteBatch() falls back to Promise.all(quote) when inner feed lacks quoteBatch', async () => {
    const alpaca = makeQuoteFeed(); // no quoteBatch
    const router = new RoutingQuoteFeed({ equity: alpaca });

    const out = await router.quoteBatch([aapl, msft]);

    expect(out).toHaveLength(2);
    expect(alpaca.quote).toHaveBeenCalledTimes(2);
    expect(alpaca.quote).toHaveBeenNthCalledWith(1, aapl);
    expect(alpaca.quote).toHaveBeenNthCalledWith(2, msft);
  });

  it('quoteBatch() throws before any inner call on unroutable asset', async () => {
    const alpaca = makeBatchQuoteFeed();
    const router = new RoutingQuoteFeed({ equity: alpaca });

    await expect(router.quoteBatch([aapl, dgs10])).rejects.toThrow(RoutingQuoteFeedError);
    expect(alpaca.quoteBatch).not.toHaveBeenCalled();
    expect(alpaca.quote).not.toHaveBeenCalled();
  });

  it('quoteBatch() propagates inner-feed rejections unchanged', async () => {
    const boom = new Error('vendor down');
    const alpaca = makeBatchQuoteFeed({
      quoteBatch: vi.fn(async () => {
        throw boom;
      }),
    });
    const router = new RoutingQuoteFeed({ equity: alpaca });

    await expect(router.quoteBatch([aapl])).rejects.toBe(boom);
  });
});
