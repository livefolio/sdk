import type { Asset, AssetId, Frequency } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Calendar } from '../interfaces/calendar';
import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';

export type PollingSchedule = { kind: 'interval'; intervalMs: number } | { kind: 'session-close'; calendar: Calendar };

export type PollingStreamOptions = {
  /** Historical feed to poll. Each tick of the schedule calls `feed.bars(asset, …)` for each subscribed asset. */
  feed: DataFeed;
  /** Bar frequency to request. Single value — multi-frequency requires composing two polling streams via `RoutingStreamingDataFeed`. */
  freq: Frequency;
  /** When to poll. */
  schedule: PollingSchedule;
  /**
   * Window-start for the first poll per asset. Subsequent polls fetch
   * `(lastSeenT, now]` per asset. Defaults to `new Date(0)` — every bar the
   * feed has on the first poll is yielded. For replay-then-stream, set this
   * to your backtest range's `to` so polling picks up exactly where the
   * backtest left off.
   */
  initialFrom?: Date;
  /** Inject for tests or for accelerated-time simulations. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Inject for tests or for accelerated-time simulations. Defaults to `setTimeout`-based promise. */
  sleep?: (ms: number) => Promise<void>;
};

export function pollingStreamFromHistorical(opts: PollingStreamOptions): StreamingDataFeed {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const initialFrom = opts.initialFrom ?? new Date(0);

  return {
    subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
      return poll(assets);
    },
  };

  async function* poll(assets: ReadonlyArray<Asset>): AsyncGenerator<StreamingBar> {
    // Dedup by id, preserve input order.
    const seen = new Set<AssetId>();
    const uniq: Asset[] = [];
    for (const a of assets) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        uniq.push(a);
      }
    }
    if (uniq.length === 0) return;

    const lastSeenT = new Map<AssetId, Date>(uniq.map((a) => [a.id, initialFrom]));

    while (true) {
      await waitForNextPoll();
      for (const asset of uniq) {
        const from = lastSeenT.get(asset.id)!;
        const to = now(); // Fresh per asset by design — for cycle-stable to, pass a custom now() that caches.
        for await (const bar of opts.feed.bars(asset, { from, to }, opts.freq)) {
          const last = lastSeenT.get(asset.id)!;
          if (bar.t.getTime() > last.getTime()) {
            yield { asset, bar };
            lastSeenT.set(asset.id, bar.t);
          }
        }
      }
    }
  }

  async function waitForNextPoll(): Promise<void> {
    if (opts.schedule.kind === 'interval') {
      await sleep(opts.schedule.intervalMs);
      return;
    }
    // Resolve the next session close via cal.schedule() lookahead rather than
    // the cal.previous(cal.next(now)) idiom: Session exposes .close (not .end),
    // and the lookahead also covers the exotic-calendar fallback below.
    const cal = opts.schedule.calendar;
    const t = now();
    const lookaheadDays = 14;
    const range = {
      from: t,
      to: new Date(t.getTime() + lookaheadDays * 24 * 60 * 60 * 1000),
    };
    const sessions = cal.schedule(range);
    const upcoming = sessions.find((s) => s.close.getTime() > t.getTime());
    if (upcoming === undefined) {
      // No session in the next N days — sleep one day and retry.
      await sleep(24 * 60 * 60 * 1000);
      return;
    }
    const delay = Math.max(0, upcoming.close.getTime() - t.getTime());
    await sleep(delay);
  }
}
