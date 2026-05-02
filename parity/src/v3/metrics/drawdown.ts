import type { DailyBar } from '../handles/indicator';
import type { DrawdownEntry } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOISE = 1e-4;

function dateUTC(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function daysBetween(a: string, b: string): number {
  return Math.round((dateUTC(b) - dateUTC(a)) / DAY_MS);
}

export function computeDrawdownTable(series: DailyBar[], topN: number): DrawdownEntry[] {
  if (series.length === 0) return [];

  type Open = { peakDate: string; peakValue: number; troughDate: string; troughValue: number };
  const segments: DrawdownEntry[] = [];
  let peakDate = series[0]!.date;
  let peakValue = series[0]!.value;
  let open: Open | null = null;

  for (let i = 0; i < series.length; i++) {
    const bar = series[i]!;
    if (bar.value >= peakValue) {
      if (open) {
        const recoveryDate = bar.date;
        const depth = open.troughValue / open.peakValue - 1;
        if (Math.abs(depth) >= NOISE) {
          segments.push({
            peakDate: open.peakDate,
            troughDate: open.troughDate,
            recoveryDate,
            depth,
            durationDays: daysBetween(open.peakDate, recoveryDate),
            underwaterDays: daysBetween(open.peakDate, open.troughDate),
          });
        }
        open = null;
      }
      peakDate = bar.date;
      peakValue = bar.value;
    } else {
      if (!open) {
        open = { peakDate, peakValue, troughDate: bar.date, troughValue: bar.value };
      } else if (bar.value < open.troughValue) {
        open.troughDate = bar.date;
        open.troughValue = bar.value;
      }
    }
  }

  if (open) {
    const lastDate = series[series.length - 1]!.date;
    const depth = open.troughValue / open.peakValue - 1;
    if (Math.abs(depth) >= NOISE) {
      segments.push({
        peakDate: open.peakDate,
        troughDate: open.troughDate,
        recoveryDate: null,
        depth,
        durationDays: daysBetween(open.peakDate, lastDate),
        underwaterDays: daysBetween(open.peakDate, open.troughDate),
      });
    }
  }

  segments.sort((a, b) => Math.abs(b.depth) - Math.abs(a.depth));
  return segments.slice(0, topN);
}

export function currentDrawdown(series: DailyBar[]): number {
  if (series.length === 0) return 0;
  let runningMax = -Infinity;
  for (const bar of series) {
    if (bar.value > runningMax) runningMax = bar.value;
  }
  const last = series[series.length - 1]!.value;
  return last / runningMax - 1;
}
