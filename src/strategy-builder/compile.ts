import { compileRules } from '../strategy/rules';
import type {
  Condition,
  Indicator,
  NotExpr,
  Signal,
  SignalExpr,
  SignalNameCondition,
  SignalNameUnaryExpr,
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

function nodeToCondition(node: DraftConditionNode): SignalNameUnaryExpr {
  return node.not
    ? { kind: 'not', signalName: node.signalName }
    : { kind: 'signal', signalName: node.signalName };
}

function allocationCondition(groups: DraftAllocation['groups']): SignalNameCondition {
  if (groups.length === 0) {
    return { kind: 'and', args: [] };
  }

  const andGroups = groups
    .filter((group) => group.length > 0)
    .map((group) => ({
      kind: 'and' as const,
      args: group.map(nodeToCondition),
    }));

  if (andGroups.length === 0) {
    return { kind: 'and', args: [] };
  }
  if (andGroups.length === 1) {
    return andGroups[0];
  }
  return { kind: 'or', args: andGroups };
}

export function compileDraftStrategy(draft: StrategyDraft): Strategy {
  return compileRules({
    linkId: 'custom-strategy',
    name: draft.name.trim() || 'Custom Strategy',
    trading: draft.trading,
    signals: draft.signals.map((draftSignal) => ({
      name: draftSignal.name.trim(),
      signal: mapSignal(draftSignal),
    })),
    allocations: draft.allocations.map((allocation) => {
      return {
        name: allocation.name.trim(),
        condition: allocationCondition(allocation.groups),
        holdings: allocation.holdings.map((holding) => ({
          ticker: { symbol: holding.ticker.symbol.trim().toUpperCase(), leverage: 1 },
          weight: Number(holding.weight),
        })),
        rebalance: allocation.rebalance,
      };
    }),
  });
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
    signal.left.ticker.leverage,
    signal.left.lookback,
    signal.left.delay,
    signal.left.unit ?? '',
    signal.left.threshold ?? '',
    signal.comparison,
    signal.right.type,
    signal.right.ticker.symbol,
    signal.right.ticker.leverage,
    signal.right.lookback,
    signal.right.delay,
    signal.right.unit ?? '',
    signal.right.threshold ?? '',
    signal.tolerance ?? 0,
  ].join('|');
}

function resolveSignalName(expr: SignalExpr | NotExpr, signalNameByFingerprint: Map<string, string>): string {
  const signalName = signalNameByFingerprint.get(signalFingerprint(expr.signal));
  if (!signalName) {
    throw new Error('Failed to resolve strategy condition back to a named signal.');
  }
  return signalName;
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
    const fingerprint = signalFingerprint(namedSignal.signal);
    if (signalNameByFingerprint.has(fingerprint)) {
      throw new Error(
        `Strategy contains duplicate signal definitions for "${namedSignal.name}", which cannot be round-tripped to named draft conditions.`,
      );
    }
    signalNameByFingerprint.set(fingerprint, namedSignal.name);
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
      rebalance: allocation.allocation.rebalance ?? { mode: 'on_change' },
    })),
  };
}
