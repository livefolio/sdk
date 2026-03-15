import type { MarketModule } from '../market/types';
import { TRACKED_TICKERS_YFINANCE } from '../market/trackedTickers';
import { backtestWithMarketData } from '../strategy/backtest';
import type { BacktestOptions } from '../strategy/types';
import { compileDraftStrategy } from './compile';
import type { BacktestResult, BacktestTrade, StrategyDraft } from './types';

export const TRACKED_TICKERS_DESCRIPTION =
  'Curated default strategy-builder ticker universe in Yahoo Finance symbol format.';

export const TRACKED_TICKERS = TRACKED_TICKERS_YFINANCE;

function toBuilderTrades(trades: Awaited<ReturnType<typeof backtestWithMarketData>>['trades']): BacktestTrade[] {
  return trades.map((trade) => ({
    date: trade.date,
    ticker: trade.ticker,
    shares: Math.abs(trade.shares),
    price: trade.price,
    value: Math.abs(trade.value),
    action: trade.action,
    allocation: trade.allocation,
  }));
}

export async function runDraftBacktest(
  market: Pick<MarketModule, 'getBatchSeriesFromDb' | 'getTradingDays'>,
  draft: StrategyDraft,
  options: Omit<BacktestOptions, 'allocationRebalance'>,
): Promise<BacktestResult> {
  const strategy = compileDraftStrategy(draft);
  const result = await backtestWithMarketData(market, strategy, options);

  return {
    strategy,
    summary: result.summary,
    timeseries: {
      dates: result.timeseries.dates,
      portfolio: result.timeseries.portfolio,
      drawdownPct: result.timeseries.drawdownPct,
      allocation: result.timeseries.allocation,
    },
    trades: toBuilderTrades(result.trades),
    annualTax: result.annualTax,
  };
}
