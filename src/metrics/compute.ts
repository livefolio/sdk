import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';
import type { DrawdownEntry, MetricsOptions, MetricsResult } from './types';
import { dailyReturns, monthlyReturns, yearlyReturns } from './returns';
import { totalReturn, cagr, years, bestYear, worstYear, bestMonth, worstMonth, pctPositiveMonths } from './summary';
import {
  volatility,
  downsideDeviation,
  skewness,
  excessKurtosis,
  historicalVar,
  historicalCvar,
  ulcerIndex,
} from './risk';
import { computeDrawdownTable, currentDrawdown } from './drawdown';
import { sharpe, sortino, calmar, dailyRiskFree } from './riskAdjusted';
import { rebalanceCount, tradeCount, turnover, winRatePerRebalance } from './activity';
import { buildMonthlyTable, buildYearlyList } from './tables';

export function computeMetrics(series: DailyBar[], trades: Trade[], options: MetricsOptions = {}): MetricsResult {
  if (series.length < 2) {
    throw new Error('metrics requires at least 2 daily bars');
  }
  const rfAnnual = options.riskFreeRate ?? 0;
  const topN = options.topDrawdowns ?? 5;
  const conf = options.varConfidence ?? 0.95;

  const ret = dailyReturns(series);
  const monthly = monthlyReturns(series);
  const yearly = yearlyReturns(series);
  const yrs = years(series);

  const dds = computeDrawdownTable(series, Math.max(topN, 1));
  const maxDd: DrawdownEntry = dds[0] ?? {
    peakDate: series[0]!.date,
    troughDate: series[0]!.date,
    recoveryDate: series[series.length - 1]!.date,
    depth: 0,
    durationDays: 0,
    underwaterDays: 0,
  };
  const cagrVal = cagr(series);

  return {
    range: { from: series[0]!.date, to: series[series.length - 1]!.date, years: yrs },
    returns: {
      totalReturn: totalReturn(series),
      cagr: cagrVal,
      bestYear: bestYear(yearly),
      worstYear: worstYear(yearly),
      bestMonth: bestMonth(monthly),
      worstMonth: worstMonth(monthly),
      pctPositiveMonths: pctPositiveMonths(monthly),
    },
    risk: {
      volatility: volatility(ret),
      downsideDeviation: downsideDeviation(ret, dailyRiskFree(rfAnnual)),
      maxDrawdown: maxDd,
      currentDrawdown: currentDrawdown(series),
      ulcerIndex: ulcerIndex(series),
      skew: skewness(ret),
      kurtosis: excessKurtosis(ret),
      var95: historicalVar(ret, conf),
      cvar95: historicalCvar(ret, conf),
    },
    riskAdjusted: {
      sharpe: sharpe(ret, rfAnnual),
      sortino: sortino(ret, rfAnnual),
      calmar: calmar(cagrVal, maxDd.depth),
    },
    activity: {
      rebalances: rebalanceCount(trades),
      trades: tradeCount(trades),
      turnover: turnover(trades, series, yrs),
      winRate: winRatePerRebalance(series, trades),
    },
    tables: {
      drawdowns: dds.slice(0, topN),
      monthly: buildMonthlyTable(monthly),
      yearly: buildYearlyList(yearly),
    },
  };
}
