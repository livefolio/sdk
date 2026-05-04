import { describe, it, expect } from 'vitest';
import type { StreamingDataFeed, StreamingBar } from './streaming-data-feed';

describe('StreamingDataFeed interface', () => {
  it('a mock implementation compiles and is iterable', async () => {
    const feed: StreamingDataFeed = {
      async *subscribe() {
        yield {
          asset: { kind: 'equity', id: 'SPY', symbol: 'SPY' },
          bar: { t: new Date('2024-06-03T13:30:00Z'), open: 530, high: 530, low: 530, close: 530, volume: 0 },
        };
      },
    };

    const out: StreamingBar[] = [];
    for await (const tick of feed.subscribe([{ kind: 'equity', id: 'SPY', symbol: 'SPY' }])) {
      out.push(tick);
      break; // open-ended, must break
    }
    expect(out).toHaveLength(1);
    expect(out[0]?.asset.id).toBe('SPY');
  });
});
