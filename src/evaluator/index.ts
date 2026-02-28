import type { TypedSupabaseClient } from '../types';

export interface EvaluatorModule {
  // Methods will be added as evaluator features are implemented
}

export function createEvaluator(_client: TypedSupabaseClient): EvaluatorModule {
  return {};
}
