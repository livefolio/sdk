import type { TypedSupabaseClient } from '../types';
import type { EvaluatorModule } from './types';

export function createEvaluator(_client: TypedSupabaseClient): EvaluatorModule {
  return {};
}
