import { AllocationHandle } from './allocation';

export function allocationsEqual(a: AllocationHandle | null, b: AllocationHandle | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const aj = a.toJSON();
  const bj = b.toJSON();
  if (aj.length !== bj.length) return false;
  for (let i = 0; i < aj.length; i++) {
    if (aj[i]!.symbol !== bj[i]!.symbol) return false;
    if (aj[i]!.leverage !== bj[i]!.leverage) return false;
    if (Math.abs(aj[i]!.weight - bj[i]!.weight) > 1e-9) return false;
  }
  return true;
}
