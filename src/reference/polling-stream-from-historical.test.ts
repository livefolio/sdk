import { describe, it, expect, vi } from 'vitest';
import { pollingStreamFromHistorical } from './polling-stream-from-historical';
import type { Asset, Bar, DateRange, Frequency } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Calendar, Session } from '../interfaces/calendar';
import type { StreamingBar } from '../interfaces/streaming-data-feed';

const equity: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
const macro: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };

function makeBar(t: string, close = 1): Bar {
  return { t: new Date(t), open: close, high: close, low: close, close, volume: 0 };
}

async function drain(it: AsyncIterable<StreamingBar>, n: number): Promise<StreamingBar[]> {
  const out: StreamingBar[] = [];
  for await (const x of it) {
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

// Mock DataFeed that returns a sequence of bar arrays per call.
function makeFeed(calls: ReadonlyArray<ReadonlyArray<Bar>>): DataFeed {
  let callIdx = 0;
  return {
    bars: vi.fn(async function* (_asset: Asset, _range: DateRange, _freq: Frequency) {
      const batch = calls[callIdx++] ?? [];
      for (const bar of batch) yield bar;
    }),
  };
}

describe('pollingStreamFromHistorical', () => {
  it('1. single asset, interval schedule: after first sleep, polls; new bars yielded; lastSeenT advances', async () => {
    const bar1 = makeBar('2024-06-03T10:00:00Z', 100);
    const bar2 = makeBar('2024-06-04T10:00:00Z', 101);
    // call 0 (poll 1): returns bar1; call 1 (poll 2): returns bar2
    const feed = makeFeed([[bar1], [bar2]]);
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-05T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 5000 },
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([equity]), 2);

    expect(sleep).toHaveBeenCalledWith(5000);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });
    expect(ticks[1]).toEqual({ asset: equity, bar: bar2 });

    // Second poll's from should be bar1.t (lastSeenT advanced)
    const secondCallArgs = (feed.bars as ReturnType<typeof vi.fn>).mock.calls[1] as [Asset, DateRange, Frequency];
    expect(secondCallArgs[1].from).toEqual(bar1.t);
  });

  it('2. two assets: each polled per cycle in input order; each tracks its own lastSeenT', async () => {
    const barA1 = makeBar('2024-06-03T10:00:00Z', 100);
    const barB1 = makeBar('2024-06-03T10:00:00Z', 200);
    const barA2 = makeBar('2024-06-05T10:00:00Z', 110);

    // call 1 (equity poll1): barA1; call 2 (macro poll1): barB1
    // call 3 (equity poll2): barA2; call 4 (macro poll2): nothing
    let callNum = 0;
    const feed: DataFeed = {
      bars: vi.fn(async function* (_asset: Asset, _range: DateRange, _freq: Frequency) {
        callNum++;
        if (callNum === 1) yield barA1;
        else if (callNum === 2) yield barB1;
        else if (callNum === 3) yield barA2;
        // call 4: nothing
      }),
    };

    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-06T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      sleep,
      now,
    });

    // Drain 3 ticks: barA1, barB1 from poll1; barA2 from poll2
    const ticks = await drain(sdf.subscribe([equity, macro]), 3);

    expect(ticks[0]).toEqual({ asset: equity, bar: barA1 });
    expect(ticks[1]).toEqual({ asset: macro, bar: barB1 });
    expect(ticks[2]).toEqual({ asset: equity, bar: barA2 });

    const barsCallArgs = (feed.bars as ReturnType<typeof vi.fn>).mock.calls as Array<[Asset, DateRange, Frequency]>;
    // poll1 calls (indices 0 and 1): both start from epoch (independent lastSeenT per asset)
    expect(barsCallArgs[0]?.[0].id).toBe('AAPL');
    expect(barsCallArgs[0]?.[1].from).toEqual(new Date(0));
    expect(barsCallArgs[1]?.[0].id).toBe('DGS10');
    expect(barsCallArgs[1]?.[1].from).toEqual(new Date(0));
    // poll2 equity call (index 2): from should be barA1.t (lastSeenT advanced for equity)
    expect(barsCallArgs[2]?.[0].id).toBe('AAPL');
    expect(barsCallArgs[2]?.[1].from).toEqual(barA1.t);
  });

  it('3. empty feed.bars() result on a poll: nothing yielded; next poll covers (prevLastSeen, newer-now]', async () => {
    const bar1 = makeBar('2024-06-04T10:00:00Z', 100);
    // poll1: empty; poll2: bar1
    const feed = makeFeed([[], [bar1]]);
    const sleep = vi.fn(async () => {});
    let callCount = 0;
    const now = vi.fn(() => {
      callCount++;
      // Return different times to distinguish polls
      return callCount <= 2 ? new Date('2024-06-03T12:00:00Z') : new Date('2024-06-05T12:00:00Z');
    });

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([equity]), 1);

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });

    // poll2's from should be epoch (new Date(0)) since poll1 returned nothing
    const barsCallArgs = (feed.bars as ReturnType<typeof vi.fn>).mock.calls as Array<[Asset, DateRange, Frequency]>;
    expect(barsCallArgs[1]?.[1].from).toEqual(new Date(0));
  });

  it('4. bar with t === lastSeenT re-published: not yielded', async () => {
    const bar1 = makeBar('2024-06-03T10:00:00Z', 100);
    const barDup = makeBar('2024-06-03T10:00:00Z', 101); // same t as bar1
    const bar2 = makeBar('2024-06-04T10:00:00Z', 102);
    // poll1: yields bar1; poll2: yields barDup (same t) and bar2 (newer)
    const feed = makeFeed([[bar1], [barDup, bar2]]);
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-05T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([equity]), 2);

    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });
    // barDup is skipped; bar2 is the second
    expect(ticks[1]).toEqual({ asset: equity, bar: bar2 });
  });

  it('5. bar with t < lastSeenT (revised backwards): not yielded', async () => {
    const bar1 = makeBar('2024-06-04T10:00:00Z', 100);
    const barOld = makeBar('2024-06-01T10:00:00Z', 99); // older than bar1
    const bar2 = makeBar('2024-06-05T10:00:00Z', 101);
    // poll1: bar1; poll2: barOld (dropped) and bar2 (yielded)
    const feed = makeFeed([[bar1], [barOld, bar2]]);
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-06T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([equity]), 2);

    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });
    expect(ticks[1]).toEqual({ asset: equity, bar: bar2 });
    expect(ticks).toHaveLength(2);
  });

  it('6. feed.bars() throws: error propagates to consumer', async () => {
    const boom = new Error('data source unavailable');
    const feed: DataFeed = {
      bars: vi.fn(() => ({
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<Bar>> {
              return Promise.reject(boom);
            },
          };
        },
      })),
    };
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-05T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      sleep,
      now,
    });

    const iter = sdf.subscribe([equity])[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow('data source unavailable');
  });

  it('7. initialFrom set: first poll from is initialFrom, not epoch', async () => {
    const initialFrom = new Date('2024-05-01T00:00:00Z');
    const bar1 = makeBar('2024-06-03T10:00:00Z', 100);
    const feed = makeFeed([[bar1]]);
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-05T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      initialFrom,
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([equity]), 1);
    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });

    const firstCallArgs = (feed.bars as ReturnType<typeof vi.fn>).mock.calls[0] as [Asset, DateRange, Frequency];
    expect(firstCallArgs[1].from).toEqual(initialFrom);
  });

  it('8. empty assets: subscribe returns immediately; sleep never called', async () => {
    const feed = makeFeed([]);
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-05T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([]), 1);

    expect(ticks).toHaveLength(0);
    expect(sleep).not.toHaveBeenCalled();
    expect(feed.bars).not.toHaveBeenCalled();
  });

  it('9. duplicate asset in assets: deduplicated by id (one poll per cycle, not two)', async () => {
    const bar1 = makeBar('2024-06-03T10:00:00Z', 100);
    const feed = makeFeed([[bar1]]);
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => new Date('2024-06-05T12:00:00Z'));

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'interval', intervalMs: 1000 },
      sleep,
      now,
    });

    // Pass the same asset twice
    const ticks = await drain(sdf.subscribe([equity, equity]), 1);

    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });
    // bars() should be called only once per cycle (deduped)
    expect(feed.bars).toHaveBeenCalledTimes(1);
  });

  it('10. session-close schedule: sleep called with delay until upcoming session close', async () => {
    const bar1 = makeBar('2024-06-03T20:00:00Z', 100);
    const feed = makeFeed([[bar1]]);
    const sleep = vi.fn(async () => {});

    const nowInstant = new Date('2024-06-03T13:00:00Z');
    const now = vi.fn(() => nowInstant);

    // Session whose close is after now
    const sessionClose = new Date('2024-06-03T20:00:00Z');
    const session: Session = {
      date: new Date('2024-06-03T00:00:00Z'),
      open: new Date('2024-06-03T13:30:00Z'),
      close: sessionClose,
    };

    const calendar: Calendar = {
      schedule: vi.fn(() => [session]),
      isOpen: vi.fn(() => false),
      next: vi.fn((t: Date) => t),
      previous: vi.fn((t: Date) => t),
      sessions: vi.fn(() => []),
      isEarlyClose: vi.fn(() => false),
    };

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'session-close', calendar },
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([equity]), 1);
    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });

    const expectedDelay = sessionClose.getTime() - nowInstant.getTime();
    expect(sleep).toHaveBeenCalledWith(expectedDelay);
    expect(calendar.schedule).toHaveBeenCalled();
  });

  it('11. session-close schedule with empty schedule(): falls back to 24h sleep, then retries', async () => {
    const bar1 = makeBar('2024-06-04T20:00:00Z', 100);
    // poll1 (after 24h fallback): empty; poll2 (after session-close sleep): bar1
    const feed = makeFeed([[], [bar1]]);
    const sleep = vi.fn(async () => {});

    const nowInstant = new Date('2024-06-03T13:00:00Z');
    const now = vi.fn(() => nowInstant);

    // First schedule() call returns [] (triggers 24h fallback);
    // second call returns a real session so the loop progresses.
    const sessionClose = new Date('2024-06-04T20:00:00Z');
    const session: Session = {
      date: new Date('2024-06-04T00:00:00Z'),
      open: new Date('2024-06-04T13:30:00Z'),
      close: sessionClose,
    };

    let scheduleCalls = 0;
    const calendar: Calendar = {
      schedule: vi.fn(() => {
        scheduleCalls++;
        return scheduleCalls === 1 ? [] : [session];
      }),
      isOpen: vi.fn(() => false),
      next: vi.fn((t: Date) => t),
      previous: vi.fn((t: Date) => t),
      sessions: vi.fn(() => []),
      isEarlyClose: vi.fn(() => false),
    };

    const sdf = pollingStreamFromHistorical({
      feed,
      freq: '1d',
      schedule: { kind: 'session-close', calendar },
      sleep,
      now,
    });

    const ticks = await drain(sdf.subscribe([equity]), 1);
    expect(ticks[0]).toEqual({ asset: equity, bar: bar1 });

    // First sleep call: 24h fallback (empty schedule)
    expect(sleep).toHaveBeenNthCalledWith(1, 24 * 60 * 60 * 1000);
    // Second sleep call: delay until session close
    const expectedDelay = sessionClose.getTime() - nowInstant.getTime();
    expect(sleep).toHaveBeenNthCalledWith(2, expectedDelay);
    // schedule() was called at least twice (once empty, once with session)
    expect(calendar.schedule).toHaveBeenCalledTimes(2);
  });
});
