import type { DailyBar } from '../handles/indicator.js';

type Comparison = '>' | '<' | '=';

function computeBuffers(v2: number, tolerance: number, absolute: boolean): { upper: number; lower: number } {
  if (tolerance === 0) return { upper: v2, lower: v2 };
  if (absolute) return { upper: v2 + tolerance, lower: v2 - tolerance };
  return { upper: v2 * (1 + tolerance / 100), lower: v2 * (1 - tolerance / 100) };
}

function rawCompare(v1: number, v2: number, comparison: Comparison): number {
  switch (comparison) {
    case '>':
      return v1 > v2 ? 1 : 0;
    case '<':
      return v1 < v2 ? 1 : 0;
    case '=':
      return v1 === v2 ? 1 : 0;
  }
}

export function evaluateSignal(
  series1: DailyBar[],
  series2: DailyBar[],
  comparison: Comparison,
  tolerance: number,
  absolute: boolean,
  previousValue?: number,
): DailyBar[] {
  const s2Map = new Map<string, number>();
  for (const bar of series2) {
    s2Map.set(bar.date, bar.value);
  }

  const result: DailyBar[] = [];
  let prev = previousValue;

  for (const bar1 of series1) {
    const v2 = s2Map.get(bar1.date);
    if (v2 === undefined) continue;

    const v1 = bar1.value;
    const { upper, lower } = computeBuffers(v2, tolerance, absolute);

    let value: number;

    if (tolerance === 0) {
      value = rawCompare(v1, v2, comparison);
    } else if (comparison === '=') {
      value = v1 >= lower && v1 <= upper ? 1 : 0;
    } else if (prev === undefined) {
      value = rawCompare(v1, v2, comparison);
    } else if (comparison === '>') {
      if (prev === 1) {
        value = v1 < lower ? 0 : 1;
      } else {
        value = v1 > upper ? 1 : 0;
      }
    } else {
      // comparison === '<'
      if (prev === 1) {
        value = v1 > upper ? 0 : 1;
      } else {
        value = v1 < lower ? 1 : 0;
      }
    }

    result.push({ date: bar1.date, value });
    prev = value;
  }

  return result;
}
