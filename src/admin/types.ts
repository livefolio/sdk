import type { StrategyEvaluation, Strategy } from '../strategy/types';

// ---------------------------------------------------------------------------
// Admin module interface — operations requiring service-role access
// ---------------------------------------------------------------------------

export interface UpsertEvaluationParams {
  strategy: Strategy;
  result: StrategyEvaluation;
  tradingDayId: number;
}

export interface UpsertObservationsParams {
  tickerId: number;
  observations: { date: string; value: number }[];
}

export interface AdminModule {
  upsertEvaluation(params: UpsertEvaluationParams): Promise<void>;
  upsertObservations(params: UpsertObservationsParams): Promise<void>;
}
