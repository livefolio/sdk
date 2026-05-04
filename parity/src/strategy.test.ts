import { describe, it, expect } from 'vitest';
import { PARITY_SPEC, PARITY_RANGE, PARITY_RANGE_V3 } from './strategy';

describe('PARITY_SPEC', () => {
  it('declares tactical/v1 kind', () => {
    expect(PARITY_SPEC.kind).toBe('tactical/v1');
  });

  it('every feature ref in rules is declared in features', () => {
    const featureIds = new Set(PARITY_SPEC.features.map((f) => f.id));
    function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.op === 'if') {
        const cond = n.cond as { left: unknown; right: unknown };
        for (const side of [cond.left, cond.right]) {
          if (side && typeof side === 'object' && 'ref' in (side as object)) {
            expect(featureIds.has((side as { ref: string }).ref)).toBe(true);
          }
        }
        walk(n.then);
        walk(n.else);
      }
    }
    walk(PARITY_SPEC.rules);
  });

  it('every weight key is in the universe', () => {
    const universeIds = new Set(PARITY_SPEC.universe.map((u) => u.id));
    function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.op === 'allocate') {
        for (const k of Object.keys(n.weights as Record<string, number>)) {
          expect(universeIds.has(k)).toBe(true);
        }
      } else if (n.op === 'if') {
        walk(n.then);
        walk(n.else);
      }
    }
    walk(PARITY_SPEC.rules);
  });

  it('range bounds match across v0.3 and v0.4 forms', () => {
    expect(PARITY_RANGE_V3.from).toBe('2020-06-01');
    expect(PARITY_RANGE_V3.to).toBe('2026-05-02');
    expect(PARITY_RANGE.from.toISOString().slice(0, 10)).toBe('2020-06-01');
    expect(PARITY_RANGE.to.toISOString().slice(0, 10)).toBe('2026-05-02');
  });
});
