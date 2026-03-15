import type {
  AndExpr,
  Condition,
  Indicator,
  NotExpr,
  Signal,
  SignalExpr,
  Strategy,
  UnaryExpr,
} from '../strategy/types';
import type { DraftAllocation, DraftConditionNode, DraftIndicator, DraftSignal, StrategyDraft } from './types';

function indicatorUnit(type: Indicator['type']): Indicator['unit'] {
  if (
    type === 'Threshold'
    || type === 'Month'
    || type === 'Day of Week'
    || type === 'Day of Month'
    || type === 'Day of Year'
    || type === 'RSI'
  ) {
    return null;
  }
  if (type === 'Return' || type === 'Volatility' || type === 'Drawdown' || type.startsWith('T')) {
    return '%';
  }
  return '$';
}

function mapIndicator(source: DraftIndicator): Indicator {
  const normalizedType = source.type;
  const symbol = normalizedType === 'Threshold' ? '' : source.ticker.trim().toUpperCase();
  return {
    type: normalizedType,
    ticker: { symbol, leverage: 1 },
    lookback: Math.max(1, Number(source.lookback || 1)),
    delay: Math.max(0, Number(source.delay || 0)),
    unit: indicatorUnit(normalizedType),
    threshold: normalizedType === 'Threshold' ? (source.threshold ?? 0) : null,
  };
}

function mapSignal(source: DraftSignal): Signal {
  return {
    left: mapIndicator(source.left),
    comparison: source.comparison,
    right: mapIndicator(source.right),
    tolerance: Number(source.tolerance ?? 0),
  };
}

function compileUnary(node: DraftConditionNode, signalByName: Map<string, Signal>): UnaryExpr {
  const signal = signalByName.get(node.signalName);
  if (!signal) {
    throw new Error(`Unknown signal reference "${node.signalName}".`);
  }
  return node.not ? ({ kind: 'not', signal } satisfies NotExpr) : ({ kind: 'signal', signal } satisfies SignalExpr);
}

function compileCondition(allocation: DraftAllocation, signalByName: Map<string, Signal>): Condition {
  const groups = allocation.groups ?? [];
  if (groups.length === 0) {
    return { kind: 'and', args: [] };
  }

  const andExprs: AndExpr[] = groups
    .filter((group) => group.length > 0)
    .map((group) => ({
      kind: 'and',
      args: group.map((node) => compileUnary(node, signalByName)),
    }));

  if (andExprs.length === 0) {
    return { kind: 'and', args: [] };
  }
  if (andExprs.length === 1) {
    return andExprs[0];
  }
  return { kind: 'or', args: andExprs };
}

function validateHoldings(name: string, holdings: Strategy['allocations'][number]['allocation']['holdings']): void {
  const total = holdings.reduce((sum, holding) => sum + Number(holding.weight || 0), 0);
  if (Math.abs(total - 100) > 1e-6) {
    throw new Error(`Allocation "${name}" holdings must sum to 100.`);
  }
}

export function compileDraftStrategy(draft: StrategyDraft): Strategy {
  if (!draft.signals.length) {
    throw new Error('At least one signal is required.');
  }
  if (!draft.allocations.length) {
    throw new Error('At least one allocation is required.');
  }

  const signals = draft.signals.map(mapSignal);
  const signalByName = new Map<string, Signal>();
  for (let index = 0; index < draft.signals.length; index += 1) {
    const name = draft.signals[index].name.trim();
    if (!name) {
      throw new Error('Signal name is required.');
    }
    if (signalByName.has(name)) {
      throw new Error(`Duplicate signal name "${name}".`);
    }
    signalByName.set(name, signals[index]);
  }

  const defaultIndexes = draft.allocations
    .map((allocation, index) => ({ allocation, index }))
    .filter((entry) => entry.allocation.name.trim().toLowerCase() === 'default');

  if (defaultIndexes.length !== 1) {
    throw new Error('Exactly one allocation named "Default" is required.');
  }
  if (defaultIndexes[0].index !== draft.allocations.length - 1) {
    throw new Error('Allocation "Default" must be last.');
  }

  return {
    linkId: 'custom-strategy',
    name: draft.name.trim() || 'Custom Strategy',
    trading: draft.trading,
    signals: draft.signals.map((draftSignal, index) => ({
      name: draftSignal.name.trim(),
      signal: signals[index],
    })),
    allocations: draft.allocations.map((allocation) => {
      if (!allocation.name.trim()) {
        throw new Error('Allocation name is required.');
      }
      const holdings = allocation.holdings.map((holding) => ({
        ticker: { symbol: holding.ticker.symbol.trim().toUpperCase(), leverage: 1 },
        weight: Number(holding.weight),
      }));
      validateHoldings(allocation.name, holdings);

      return {
        name: allocation.name.trim(),
        allocation: {
          condition: compileCondition(allocation, signalByName),
          holdings,
        },
      };
    }),
  };
}

function toDraftSignal(namedSignal: Strategy['signals'][number]): DraftSignal {
  return {
    name: namedSignal.name,
    comparison: namedSignal.signal.comparison,
    tolerance: namedSignal.signal.tolerance ?? 0,
    left: {
      type: namedSignal.signal.left.type,
      ticker: namedSignal.signal.left.ticker.symbol,
      lookback: namedSignal.signal.left.lookback,
      delay: namedSignal.signal.left.delay,
      threshold: namedSignal.signal.left.threshold,
    },
    right: {
      type: namedSignal.signal.right.type,
      ticker: namedSignal.signal.right.ticker.symbol,
      lookback: namedSignal.signal.right.lookback,
      delay: namedSignal.signal.right.delay,
      threshold: namedSignal.signal.right.threshold,
    },
  };
}

function signalFingerprint(signal: Signal): string {
  return [
    signal.left.type,
    signal.left.ticker.symbol,
    signal.left.lookback,
    signal.left.delay,
    signal.left.threshold ?? '',
    signal.comparison,
    signal.right.type,
    signal.right.ticker.symbol,
    signal.right.lookback,
    signal.right.delay,
    signal.right.threshold ?? '',
    signal.tolerance ?? 0,
  ].join('|');
}

function resolveSignalName(expr: SignalExpr | NotExpr, signalNameByFingerprint: Map<string, string>): string {
  return signalNameByFingerprint.get(signalFingerprint(expr.signal)) ?? 'Signal 1';
}

function unaryToNode(
  unary: UnaryExpr,
  signalNameByFingerprint: Map<string, string>,
): DraftConditionNode {
  if (unary.kind === 'signal') {
    return { signalName: resolveSignalName(unary, signalNameByFingerprint), not: false };
  }
  return { signalName: resolveSignalName(unary, signalNameByFingerprint), not: true };
}

function conditionToGroups(
  condition: Condition,
  signalNameByFingerprint: Map<string, string>,
): DraftConditionNode[][] {
  if (condition.kind === 'or') {
    return condition.args.map((andExpr) => andExpr.args.map((unary) => unaryToNode(unary, signalNameByFingerprint)));
  }
  if (condition.kind === 'and') {
    return [condition.args.map((unary) => unaryToNode(unary, signalNameByFingerprint))];
  }
  return [[unaryToNode(condition, signalNameByFingerprint)]];
}

export function strategyToDraft(strategy: Strategy): StrategyDraft {
  const signalNameByFingerprint = new Map<string, string>();
  for (const namedSignal of strategy.signals) {
    signalNameByFingerprint.set(signalFingerprint(namedSignal.signal), namedSignal.name);
  }

  return {
    name: strategy.name,
    trading: {
      frequency: strategy.trading.frequency,
      offset: strategy.trading.offset ?? 0,
    },
    signals: strategy.signals.map(toDraftSignal),
    allocations: strategy.allocations.map((allocation) => ({
      name: allocation.name,
      groups: conditionToGroups(allocation.allocation.condition, signalNameByFingerprint),
      holdings: allocation.allocation.holdings.map((holding) => ({
        ticker: {
          symbol: holding.ticker.symbol,
          leverage: holding.ticker.leverage,
        },
        weight: holding.weight,
      })),
      rebalance: { mode: 'on_change' },
    })),
  };
}
