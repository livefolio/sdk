export type AssetId = string;

export type Asset = {
  kind: 'equity';
  id: AssetId;
  symbol: string;
  exchange?: string;
};

export type Frequency = '1m' | '5m' | '15m' | '1h' | '1d';

export type DateRange = {
  from: Date;
  to: Date;
};

export type Bar = {
  t: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Series = ReadonlyArray<{ t: Date; v: number }>;
