import type { TypedSupabaseClient } from '../types';
import type { StrategyModule } from './types';
import {
  evaluateIndicator as evaluateIndicatorPure,
  evaluateSignal as evaluateSignalPure,
  evaluateAllocation as evaluateAllocationPure,
  getEvaluationDate as getEvaluationDatePure,
} from './evaluate';
import { extractSymbols as extractSymbolsPure } from './symbols';
import { createMarket } from '../market/client';
import { get, getMany } from './get';
import { evaluateCached } from './cache';
import { stream } from './stream';
import { backtestWithMarketData, backtestRulesWithMarketData } from './backtest';
import { compileRules as compileRulesPure } from './rules';

export function createStrategy(client: TypedSupabaseClient): StrategyModule {
  const market = createMarket(client);
  return {
    get: (linkId) => get(client, linkId),
    getMany: (linkIds) => getMany(client, linkIds),
    evaluate: (strategy, at) => evaluateCached(client, market, strategy, at),
    evaluateIndicator: evaluateIndicatorPure,
    evaluateSignal: evaluateSignalPure,
    evaluateAllocation: evaluateAllocationPure,
    getEvaluationDate: getEvaluationDatePure,
    extractSymbols: extractSymbolsPure,
    compileRules: compileRulesPure,
    backtestRules: (strategyDraft, options) => backtestRulesWithMarketData(market, strategyDraft, options),
    stream: (strategy, observation) => stream(client, market, strategy, observation),
    backtest: (strategy, options) => backtestWithMarketData(market, strategy, options),
  };
}
