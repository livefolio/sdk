import type { Asset, Bar, DateRange, Frequency } from './types';

export type Fundamentals = Readonly<Record<string, number | string | null>>;

export type EventKind = 'earnings' | 'dividend' | 'split' | 'corporate-action';

export type DataEvent = {
  kind: EventKind;
  t: Date;
  asset: Asset;
  payload: Readonly<Record<string, unknown>>;
};

export interface DataFeed {
  bars(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar>;
  fundamentals?(asset: Asset, t: Date): Promise<Fundamentals>;
  events?(range: DateRange, kinds: ReadonlyArray<EventKind>): AsyncIterable<DataEvent>;
}
