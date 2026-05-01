import type { Bar, Series } from '../interfaces/types';

export type BarField = 'open' | 'high' | 'low' | 'close' | 'volume';

export async function collectBars(it: AsyncIterable<Bar>): Promise<Bar[]> {
  const out: Bar[] = [];
  for await (const b of it) out.push(b);
  return out;
}

export function barsToSeries(bars: ReadonlyArray<Bar>, field: BarField = 'close'): Series {
  const out: { t: Date; v: number }[] = [];
  for (const b of bars) out.push({ t: b.t, v: b[field] });
  return out;
}

export function seriesAt(series: Series, t: Date): number | undefined {
  if (series.length === 0) return undefined;
  const target = t.getTime();
  // binary search for largest index where series[i].t <= target
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.t.getTime() <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans < 0 ? undefined : series[ans]!.v;
}
