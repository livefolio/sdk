import { describe, it, expect } from 'vitest';
import type { Quote, QuoteFeed } from './quote-feed';
import type { Asset } from './types';

const aapl: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };

describe('QuoteFeed interface', () => {
  it('a mock with only quote() satisfies the interface', async () => {
    const feed: QuoteFeed = {
      async quote(asset) {
        return { asset, t: new Date('2024-06-03T13:30:00Z'), price: 195.12 };
      },
    };

    const q = await feed.quote(aapl);
    expect(q.asset.id).toBe('AAPL');
    expect(q.price).toBe(195.12);
    expect(feed.quoteBatch).toBeUndefined();
  });

  it('a mock with quote() and quoteBatch() satisfies the interface', async () => {
    const feed: QuoteFeed = {
      async quote(asset) {
        return { asset, t: new Date('2024-06-03T13:30:00Z'), price: 100 };
      },
      async quoteBatch(assets) {
        return assets.map((asset) => ({
          asset,
          t: new Date('2024-06-03T13:30:00Z'),
          price: 100,
          bid: 99.99,
          ask: 100.01,
        }));
      },
    };

    const out = await feed.quoteBatch!([aapl]);
    expect(out).toHaveLength(1);
    expect(out[0]?.bid).toBe(99.99);
    expect(out[0]?.ask).toBe(100.01);
  });

  it('Quote carries optional currency without requiring it', () => {
    const minimal: Quote = { asset: aapl, t: new Date(), price: 1 };
    const withCurrency: Quote = { asset: aapl, t: new Date(), price: 1, currency: 'USD' };
    expect(minimal.currency).toBeUndefined();
    expect(withCurrency.currency).toBe('USD');
  });
});
