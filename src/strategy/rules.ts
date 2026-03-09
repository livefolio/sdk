import type {
  AndExpr,
  Condition,
  SignalNameAndExpr,
  SignalNameCondition,
  StrategyDraft,
  Signal,
  Strategy,
} from './types';

function isDefaultName(name: string): boolean {
  return name.trim().toLowerCase() === 'default';
}

function validateHoldingsWeights(strategyDraft: StrategyDraft): void {
  for (const allocation of strategyDraft.allocations) {
    if (!allocation.holdings.length) {
      throw new Error(`Allocation "${allocation.name}" must include at least one holding.`);
    }
    for (const holding of allocation.holdings) {
      if (!Number.isFinite(holding.weight)) {
        throw new Error(`Allocation "${allocation.name}" has a non-finite holding weight.`);
      }
    }
    const total = allocation.holdings.reduce((sum, holding) => sum + holding.weight, 0);
    if (!Number.isFinite(total) || Math.abs(total - 100) > 1e-6) {
      throw new Error(`Allocation "${allocation.name}" weights must sum to 100.`);
    }
  }
}

function compileRuleCondition(
  condition: SignalNameCondition,
  signalByName: Map<string, Signal>,
): Condition {
  switch (condition.kind) {
    case 'signal': {
      const signal = signalByName.get(condition.signalName);
      if (!signal) throw new Error(`Unknown signal reference: "${condition.signalName}".`);
      return { kind: 'signal', signal };
    }
    case 'not': {
      const signal = signalByName.get(condition.signalName);
      if (!signal) throw new Error(`Unknown signal reference: "${condition.signalName}".`);
      return { kind: 'not', signal };
    }
    case 'and':
      return {
        kind: 'and',
        args: condition.args.map((arg) => compileRuleCondition(arg, signalByName) as AndExpr['args'][number]),
      };
    case 'or':
      return {
        kind: 'or',
        args: condition.args.map((arg: SignalNameAndExpr) => compileRuleCondition(arg, signalByName) as AndExpr),
      };
  }
}

export function compileRules(strategyDraft: StrategyDraft): Strategy {
  if (strategyDraft.signals.length === 0) {
    throw new Error('Rule strategy must define at least one signal.');
  }
  if (strategyDraft.allocations.length === 0) {
    throw new Error('Rule strategy must define at least one allocation.');
  }

  const signalByName = new Map<string, Signal>();
  for (const signal of strategyDraft.signals) {
    if (!signal.name.trim()) {
      throw new Error('Signal names must be non-empty.');
    }
    if (signalByName.has(signal.name)) {
      throw new Error(`Duplicate signal name: "${signal.name}".`);
    }
    signalByName.set(signal.name, signal.signal);
  }

  const allocationNames = new Set<string>();
  for (const allocation of strategyDraft.allocations) {
    const normalized = allocation.name.trim().toLowerCase();
    if (!normalized) {
      throw new Error('Allocation names must be non-empty.');
    }
    if (allocationNames.has(normalized)) {
      throw new Error(`Duplicate allocation name: "${allocation.name}".`);
    }
    allocationNames.add(normalized);
  }

  const defaultAllocations = strategyDraft.allocations.filter((allocation) => isDefaultName(allocation.name));
  if (defaultAllocations.length !== 1) {
    throw new Error('Rule strategy must include exactly one allocation named "Default".');
  }

  const defaultIndex = strategyDraft.allocations.findIndex((allocation) => isDefaultName(allocation.name));
  if (defaultIndex !== strategyDraft.allocations.length - 1) {
    throw new Error('Allocation "Default" must be the final fallback allocation.');
  }

  validateHoldingsWeights(strategyDraft);

  return {
    linkId: strategyDraft.linkId,
    name: strategyDraft.name,
    trading: strategyDraft.trading,
    signals: strategyDraft.signals.map((signal) => ({ ...signal })),
    allocations: strategyDraft.allocations.map((allocation) => ({
      name: allocation.name,
      allocation: {
        condition: compileRuleCondition(allocation.condition, signalByName),
        holdings: allocation.holdings.map((holding) => ({ ...holding })),
      },
    })),
  };
}
