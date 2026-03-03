import type {
  DateValuePoint,
  PerformancePoint,
  Range,
  RecentTrade,
  ReturnsResult,
  SeriesStats,
} from './types';

// ---------------------------------------------------------------------------
// Series stats
// ---------------------------------------------------------------------------

const ANNUALIZE = Math.sqrt(252);

export function computeSeriesStats(
  points: PerformancePoint[],
  recentTradesLimit = 10,
): SeriesStats {
  if (points.length < 2) {
    return {
      sinceInceptionReturn: 0,
      cagr: 0,
      maxDrawdown: 0,
      sharpe: 0,
      volatility: 0,
      painIndex: 0,
      recoveryTime: null,
      lastTriggerDate: null,
      recentTrades: [],
    };
  }

  const firstVal = points[0].value;
  const lastVal = points[points.length - 1].value;
  const sinceInceptionReturn = firstVal > 0 ? (lastVal / firstVal - 1) * 100 : 0;

  const firstDate = new Date(points[0].date + 'T00:00:00Z').getTime();
  const lastDate = new Date(points[points.length - 1].date + 'T00:00:00Z').getTime();
  const years = Math.max(0.001, (lastDate - firstDate) / (365.25 * 24 * 60 * 60 * 1000));
  const cagr =
    firstVal > 0 && lastVal > 0
      ? (Math.pow(lastVal / firstVal, 1 / years) - 1) * 100
      : 0;

  const dailyReturns: number[] = [];
  let peak = firstVal;
  let maxDrawdown = 0;
  const drawdowns: number[] = [];
  let inDrawdown = false;
  let troughValue = 0;
  let troughIdx = -1;
  let maxRecoveryDays = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const curr = points[i].value;
    const r = prev !== 0 ? (curr - prev) / prev : 0;
    dailyReturns.push(r);

    if (curr > peak) peak = curr;
    const dd = peak > 0 ? ((curr - peak) / peak) * 100 : 0;
    if (dd < maxDrawdown) maxDrawdown = dd;
    if (dd < 0) {
      drawdowns.push(-dd);
      if (!inDrawdown) {
        inDrawdown = true;
        troughValue = curr;
        troughIdx = i;
      } else if (curr < troughValue) {
        troughValue = curr;
        troughIdx = i;
      }
    } else {
      if (inDrawdown && troughIdx >= 0) {
        const recoveryCount = i - troughIdx;
        if (recoveryCount > maxRecoveryDays) maxRecoveryDays = recoveryCount;
      }
      inDrawdown = false;
      troughIdx = -1;
    }
  }

  const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) /
    Math.max(1, dailyReturns.length - 1);
  const std = Math.sqrt(variance) || 1e-10;
  const volatility = std * ANNUALIZE * 100;
  const sharpe = (meanRet / std) * ANNUALIZE;
  const painIndex =
    drawdowns.length > 0
      ? drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length
      : 0;

  const trades: RecentTrade[] = [];
  let prevAlloc: string | null = null;
  for (const p of points) {
    if (prevAlloc !== null && p.allocation !== prevAlloc) {
      trades.push({ date: p.date, from: prevAlloc, to: p.allocation });
    }
    prevAlloc = p.allocation;
  }
  const lastTriggerDate = trades.length > 0 ? trades[trades.length - 1].date : null;
  const recentTrades = trades.slice(-recentTradesLimit).reverse();

  return {
    sinceInceptionReturn,
    cagr,
    maxDrawdown,
    sharpe,
    volatility,
    painIndex,
    recoveryTime: maxRecoveryDays > 0 ? maxRecoveryDays : null,
    lastTriggerDate,
    recentTrades,
  };
}

export function computeAlphaVsSpy(
  strategyPoints: PerformancePoint[],
  spyPoints: DateValuePoint[],
): number | null {
  if (strategyPoints.length < 2 || spyPoints.length < 2) return null;
  const strategyFirst = strategyPoints[0].value;
  const strategyLast = strategyPoints[strategyPoints.length - 1].value;
  const spyFirst = spyPoints[0].value;
  const spyLast = spyPoints[spyPoints.length - 1].value;
  if (strategyFirst === 0 || spyFirst === 0) return null;
  const strategyRet = (strategyLast / strategyFirst - 1) * 100;
  const spyRet = (spyLast / spyFirst - 1) * 100;
  return strategyRet - spyRet;
}

// ---------------------------------------------------------------------------
// Returns helpers
// ---------------------------------------------------------------------------

export function filterByRange(
  points: DateValuePoint[],
  range: Range,
): DateValuePoint[] {
  const now = new Date();
  let cutoffDate: Date;

  switch (range) {
    case 'ytd':
      cutoffDate = new Date(now.getFullYear(), 0, 1);
      break;
    case '1y':
      cutoffDate = new Date(now);
      cutoffDate.setFullYear(now.getFullYear() - 1);
      break;
    case '3y':
      cutoffDate = new Date(now);
      cutoffDate.setFullYear(now.getFullYear() - 3);
      break;
    default:
      cutoffDate = new Date(now.getFullYear(), 0, 1);
  }

  const cutoffStr = cutoffDate.toISOString().split('T')[0]!;
  return points.filter((p) => p.date >= cutoffStr);
}

export function normalizeTo100(points: DateValuePoint[]): DateValuePoint[] {
  if (points.length === 0) return [];
  const firstValue = points[0].value;
  if (firstValue === 0) return points;
  return points.map((p) => ({ ...p, value: (p.value / firstValue) * 100 }));
}

export function getAlignmentDate(
  series: Array<{ points: DateValuePoint[] }>,
): string | null {
  let latest: string | null = null;
  for (const s of series) {
    const first = s.points[0]?.date;
    if (!first) continue;
    if (latest === null || first > latest) latest = first;
  }
  return latest;
}

export function getValueAtDate(
  points: DateValuePoint[],
  targetDate: string,
): number | null {
  const exact = points.find((p) => p.date === targetDate);
  if (exact) return exact.value;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const nextIdx = sorted.findIndex((p) => p.date > targetDate);
  if (nextIdx <= 0) {
    if (sorted.length === 0) return null;
    return nextIdx < 0 ? sorted[sorted.length - 1].value : sorted[0].value;
  }
  const prev = sorted[nextIdx - 1];
  const next = sorted[nextIdx];
  const prevT = new Date(prev.date + 'T00:00:00Z').getTime();
  const nextT = new Date(next.date + 'T00:00:00Z').getTime();
  const targetT = new Date(targetDate + 'T00:00:00Z').getTime();
  if (prevT === nextT) return prev.value;
  const t = (targetT - prevT) / (nextT - prevT);
  return prev.value + t * (next.value - prev.value);
}

export function trimAndNormalizeToAlignment(
  points: DateValuePoint[],
  alignmentDate: string,
): DateValuePoint[] {
  const ref = getValueAtDate(points, alignmentDate);
  if (ref == null || ref === 0) return [];
  const normalized = points.map((p) => ({ ...p, value: (p.value / ref) * 100 }));
  return normalized.filter((p) => p.date >= alignmentDate);
}

export function returnFromAlignedPoints(aligned: DateValuePoint[]): number | null {
  if (aligned.length === 0) return null;
  return aligned[aligned.length - 1].value - 100;
}

export function computeReturnsFromPoints(
  points: DateValuePoint[],
  allSeriesForAlignment?: Array<{ points: DateValuePoint[] }>,
): ReturnsResult {
  const ranges: Range[] = ['ytd', '1y', '3y'];
  const result: ReturnsResult = { returnYTD: null, return1y: null, return3y: null };

  for (const r of ranges) {
    const filtered = filterByRange(points, r);
    if (filtered.length === 0) continue;

    let aligned: DateValuePoint[];
    if (allSeriesForAlignment) {
      const allFiltered = allSeriesForAlignment.map((s) => ({
        points: filterByRange(s.points, r),
      }));
      const alignDate = getAlignmentDate(allFiltered);
      aligned = alignDate
        ? trimAndNormalizeToAlignment(filtered, alignDate)
        : normalizeTo100(filtered);
    } else {
      aligned = normalizeTo100(filtered);
    }

    const ret = returnFromAlignedPoints(aligned);
    if (r === 'ytd') result.returnYTD = ret;
    else if (r === '1y') result.return1y = ret;
    else result.return3y = ret;
  }

  return result;
}
