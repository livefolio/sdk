import type { TradingFreq } from '../providers/types.js';

function getPeriodKey(dateStr: string, freq: TradingFreq): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();

  switch (freq) {
    case 'Weekly': {
      const thu = new Date(d);
      thu.setUTCDate(thu.getUTCDate() + 3 - ((thu.getUTCDay() + 6) % 7));
      const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${thu.getUTCFullYear()}-W${weekNo}`;
    }
    case 'Monthly':
      return `${y}-${m}`;
    case 'Bi-monthly':
      return `${y}-${Math.floor(m / 2)}`;
    case 'Quarterly':
      return `${y}-Q${Math.floor(m / 3)}`;
    case 'Every 4 Months':
      return `${y}-${Math.floor(m / 4)}`;
    case 'Semiannually':
      return `${y}-H${Math.floor(m / 6)}`;
    case 'Yearly':
      return `${y}`;
    default:
      return `${y}-${m}`;
  }
}

export function computeRebalanceDates(tradingDays: string[], freq: TradingFreq, offset: number): Set<string> {
  if (freq === 'Daily') return new Set(tradingDays);

  const groups = new Map<string, number[]>();
  for (let i = 0; i < tradingDays.length; i++) {
    const key = getPeriodKey(tradingDays[i], freq);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  const result = new Set<string>();
  for (const indices of groups.values()) {
    const lastIdx = indices[indices.length - 1];
    const targetIdx = lastIdx - offset;
    if (targetIdx >= 0 && targetIdx < tradingDays.length) {
      result.add(tradingDays[targetIdx]);
    }
  }

  return result;
}

export interface StrategyRuleInput {
  signalIds: number[];
  allocationIndex: number;
}

export function evaluateStrategy(
  signalSeries: Map<number, Map<string, boolean>>,
  rules: StrategyRuleInput[],
  rebalanceDates: Set<string>,
  tradingDays: string[],
): Map<string, number> {
  const result = new Map<string, number>();
  let current: number | undefined;

  for (const date of tradingDays) {
    if (rebalanceDates.has(date)) {
      for (const rule of rules) {
        if (rule.signalIds.length === 0) {
          current = rule.allocationIndex;
          break;
        }
        const allTrue = rule.signalIds.every((id) => signalSeries.get(id)?.get(date) ?? false);
        if (allTrue) {
          current = rule.allocationIndex;
          break;
        }
      }
    }
    if (current !== undefined) {
      result.set(date, current);
    }
  }

  return result;
}
