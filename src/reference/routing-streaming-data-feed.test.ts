import { describe, it, expect, vi } from 'vitest';
import { RoutingStreamingDataFeed, RoutingStreamingDataFeedError } from './routing-streaming-data-feed';
import type { Asset, Bar } from '../interfaces/types';
import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';

const equity: Asset = { kind: 'equity', id: 'AAPL', symbol: 'AAPL' };
const equity2: Asset = { kind: 'equity', id: 'MSFT', symbol: 'MSFT' };
const macro: Asset = { kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' };

function makeBar(t: string, close = 1): Bar {
  return { t: new Date(t), open: close, high: close, low: close, close, volume: 0 };
}

function makeStream(ticks: ReadonlyArray<StreamingBar>): StreamingDataFeed {
  return {
    subscribe: vi.fn(async function* () {
      for (const tick of ticks) yield tick;
    }),
  };
}

type ControlledStream = {
  feed: StreamingDataFeed;
  emit: (tick: StreamingBar) => void;
  finish: () => void;
  throw: (e: unknown) => void;
  subscribed: () => boolean;
  returnCalls: () => number;
};

function makeControlledStream(): ControlledStream {
  type Resolver = { kind: 'tick'; tick: StreamingBar } | { kind: 'done' } | { kind: 'throw'; err: unknown };

  const queue: Resolver[] = [];
  const waiting: Array<(r: Resolver) => void> = [];
  let subscribeCount = 0;
  let returnCount = 0;

  function enqueue(r: Resolver) {
    if (waiting.length > 0) {
      waiting.shift()!(r);
    } else {
      queue.push(r);
    }
  }

  function take(): Promise<Resolver> {
    if (queue.length > 0) return Promise.resolve(queue.shift()!);
    return new Promise((res) => waiting.push(res));
  }

  const feed: StreamingDataFeed = {
    subscribe: vi.fn(function (): AsyncIterable<StreamingBar> {
      subscribeCount++;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              const r = await take();
              if (r.kind === 'tick') return { done: false as const, value: r.tick };
              if (r.kind === 'done') return { done: true as const, value: undefined };
              throw r.err;
            },
            async return() {
              returnCount++;
              return { done: true as const, value: undefined };
            },
          };
        },
      };
    }),
  };

  return {
    feed,
    emit: (tick) => enqueue({ kind: 'tick', tick }),
    finish: () => enqueue({ kind: 'done' }),
    throw: (err) => enqueue({ kind: 'throw', err }),
    subscribed: () => subscribeCount > 0,
    returnCalls: () => returnCount,
  };
}

async function drain(it: AsyncIterable<StreamingBar>, n?: number): Promise<StreamingBar[]> {
  const out: StreamingBar[] = [];
  for await (const x of it) {
    out.push(x);
    if (n !== undefined && out.length >= n) break;
  }
  return out;
}

describe('RoutingStreamingDataFeed', () => {
  it('1. map form: routes equity to equity feed, macro to macro feed; each subscribe called once', async () => {
    const tick1: StreamingBar = { asset: equity, bar: makeBar('2024-01-01') };
    const tick2: StreamingBar = { asset: macro, bar: makeBar('2024-01-01') };
    const equityFeed = makeStream([tick1]);
    const macroFeed = makeStream([tick2]);

    const router = new RoutingStreamingDataFeed({ equity: equityFeed, macro: macroFeed });
    const ticks = await drain(router.subscribe([equity, macro]));

    expect(equityFeed.subscribe).toHaveBeenCalledTimes(1);
    expect(macroFeed.subscribe).toHaveBeenCalledTimes(1);
    expect(equityFeed.subscribe).toHaveBeenCalledWith([equity]);
    expect(macroFeed.subscribe).toHaveBeenCalledWith([macro]);
    expect(ticks).toHaveLength(2);
    expect(ticks).toContainEqual(tick1);
    expect(ticks).toContainEqual(tick2);
  });

  it('2. function form: predicate-based routing', async () => {
    const tick1: StreamingBar = { asset: equity, bar: makeBar('2024-01-01') };
    const equityFeed = makeStream([tick1]);
    const macroFeed = makeStream([]);

    const router = new RoutingStreamingDataFeed((a) => (a.kind === 'equity' ? equityFeed : macroFeed));
    const ticks = await drain(router.subscribe([equity]));

    expect(equityFeed.subscribe).toHaveBeenCalledTimes(1);
    expect(equityFeed.subscribe).toHaveBeenCalledWith([equity]);
    expect(ticks).toEqual([tick1]);
  });

  it('3. empty assets array yields immediately-done iterable; no upstream calls', async () => {
    const equityFeed = makeStream([]);
    const router = new RoutingStreamingDataFeed({ equity: equityFeed });

    const ticks = await drain(router.subscribe([]));

    expect(ticks).toHaveLength(0);
    expect(equityFeed.subscribe).not.toHaveBeenCalled();
  });

  it('4. same upstream feed for all assets: one subscribe call with all assets', async () => {
    const tick1: StreamingBar = { asset: equity, bar: makeBar('2024-01-01') };
    const tick2: StreamingBar = { asset: equity2, bar: makeBar('2024-01-02') };
    const sharedFeed = makeStream([tick1, tick2]);

    const router = new RoutingStreamingDataFeed({ equity: sharedFeed, macro: sharedFeed });
    const ticks = await drain(router.subscribe([equity, equity2]));

    expect(sharedFeed.subscribe).toHaveBeenCalledTimes(1);
    expect(sharedFeed.subscribe).toHaveBeenCalledWith([equity, equity2]);
    expect(ticks).toEqual([tick1, tick2]);
  });

  it('5. two upstream feeds, interleaved: ticks emerge in resolution order; per-asset ordering preserved', async () => {
    const aStream = makeControlledStream();
    const bStream = makeControlledStream();

    const tick1: StreamingBar = { asset: equity, bar: makeBar('2024-01-01', 10) };
    const tick2: StreamingBar = { asset: macro, bar: makeBar('2024-01-01', 20) };
    const tick3: StreamingBar = { asset: equity, bar: makeBar('2024-01-02', 11) };

    const router = new RoutingStreamingDataFeed({ equity: aStream.feed, macro: bStream.feed });
    const iterable = router.subscribe([equity, macro]);
    const iter = iterable[Symbol.asyncIterator]();

    // Arm: both iterators are waiting for next(). Emit from A first.
    aStream.emit(tick1);
    const r1 = await iter.next();
    expect(r1.value).toEqual(tick1);

    // Emit from B, then another from A.
    bStream.emit(tick2);
    const r2 = await iter.next();
    expect(r2.value).toEqual(tick2);

    aStream.emit(tick3);
    aStream.finish();
    const r3 = await iter.next();
    expect(r3.value).toEqual(tick3);

    bStream.finish();
    const r4 = await iter.next();
    expect(r4.done).toBe(true);
  });

  it('6. upstream A finishes; upstream B continues — yields Bs remaining ticks', async () => {
    const aStream = makeControlledStream();
    const bStream = makeControlledStream();

    const tick1: StreamingBar = { asset: equity, bar: makeBar('2024-01-01') };
    const tick2: StreamingBar = { asset: macro, bar: makeBar('2024-01-02') };

    const router = new RoutingStreamingDataFeed({ equity: aStream.feed, macro: bStream.feed });
    const iter = router.subscribe([equity, macro])[Symbol.asyncIterator]();

    aStream.emit(tick1);
    aStream.finish();
    bStream.emit(tick2);
    bStream.finish();

    const r1 = await iter.next();
    expect(r1.value).toEqual(tick1);
    const r2 = await iter.next();
    expect(r2.value).toEqual(tick2);
    const r3 = await iter.next();
    expect(r3.done).toBe(true);
  });

  it('7. upstream A throws — router propagates error; B return() is called', async () => {
    const aStream = makeControlledStream();
    const bStream = makeControlledStream();

    const router = new RoutingStreamingDataFeed({ equity: aStream.feed, macro: bStream.feed });
    const iter = router.subscribe([equity, macro])[Symbol.asyncIterator]();

    const err = new Error('upstream A blew up');

    // Arm both, then throw from A. B is still live and has a pending next().
    aStream.throw(err);
    // B needs to be live and waiting — emit something so it doesn't finish
    // before cleanup. Actually B is already armed with a pending next(); just
    // let the merge detect A's throw and call B.return().

    await expect(iter.next()).rejects.toThrow('upstream A blew up');
    expect(aStream.returnCalls()).toBe(1);
    expect(bStream.returnCalls()).toBe(1);
  });

  it('8. consumer break cancels all live upstream iterators', async () => {
    const aStream = makeControlledStream();
    const bStream = makeControlledStream();

    const tick1: StreamingBar = { asset: equity, bar: makeBar('2024-01-01') };

    const router = new RoutingStreamingDataFeed({ equity: aStream.feed, macro: bStream.feed });

    aStream.emit(tick1);

    const gen = router.subscribe([equity, macro])[Symbol.asyncIterator]();
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual(tick1);

    // gen.return() deterministically runs the generator's finally block,
    // which calls return() on every still-live upstream iterator.
    await gen.return!(undefined);

    expect(aStream.returnCalls()).toBe(1);
    expect(bStream.returnCalls()).toBe(1);
  });

  it('9. unroutable asset (map form, kind not present) — rejects with RoutingStreamingDataFeedError; no upstream subscribed', async () => {
    const equityFeed = makeStream([]);
    const router = new RoutingStreamingDataFeed({ equity: equityFeed });

    const iter = router.subscribe([macro])[Symbol.asyncIterator]();
    const rejection = iter.next();
    await expect(rejection).rejects.toThrow(RoutingStreamingDataFeedError);
    await expect(rejection).rejects.toThrow(/no feed registered.*kind="macro".*id="DGS10"/);

    expect(equityFeed.subscribe).not.toHaveBeenCalled();
  });

  it('10. function form returns undefined — rejects with RoutingStreamingDataFeedError', async () => {
    const router = new RoutingStreamingDataFeed(() => undefined);

    const iter = router.subscribe([equity])[Symbol.asyncIterator]();
    const rejection = iter.next();
    await expect(rejection).rejects.toThrow(RoutingStreamingDataFeedError);
    await expect(rejection).rejects.toThrow(/no feed registered.*kind="equity".*id="AAPL"/);
  });
});
