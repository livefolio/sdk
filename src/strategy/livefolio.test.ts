import { describe, expect, it, vi } from 'vitest';
import {
  canonicalizeLivefolioDefinition,
  deriveLivefolioLinkId,
  ensureLivefolioStrategy,
  hashLivefolioDefinition,
} from './livefolio';

describe('livefolio strategy identity', () => {
  it('produces identical hashes for equivalent objects with different key order', () => {
    const a = {
      name: 'My Strategy',
      trading: { offset: 0, frequency: 'Daily' },
      rules: [{ signal: 'S1', op: '>' }],
    };
    const b = {
      rules: [{ op: '>', signal: 'S1' }],
      trading: { frequency: 'Daily', offset: 0 },
      name: 'My Strategy',
    };

    expect(hashLivefolioDefinition(a)).toBe(hashLivefolioDefinition(b));
  });

  it('changes hash when definition changes', () => {
    const base = { name: 'A', trading: { frequency: 'Daily', offset: 0 } };
    const changed = { name: 'B', trading: { frequency: 'Daily', offset: 0 } };

    expect(hashLivefolioDefinition(base)).not.toBe(hashLivefolioDefinition(changed));
  });

  it('derives link id with lf- prefix', () => {
    const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(deriveLivefolioLinkId(hash)).toBe('lf-0123456789ab');
  });

  it('drops undefined keys during canonicalization', () => {
    const canonical = canonicalizeLivefolioDefinition({
      a: 1,
      b: undefined,
      c: { z: 1, y: undefined },
    } as unknown as Record<string, unknown>);

    expect(canonical).toEqual({ a: 1, c: { z: 1 } });
  });

  it('ensures strategy via adapter using canonical hash/link id', async () => {
    const ensureStrategy = vi.fn().mockResolvedValue({
      strategyId: 42,
      linkId: 'lf-abc123abc123',
      created: true,
    });

    const definition = {
      name: 'Livefolio Rule',
      trading: { frequency: 'Daily', offset: 0 },
      alloc: [{ name: 'Default', weight: 100 }],
    };

    const result = await ensureLivefolioStrategy(definition, { ensureStrategy });

    expect(ensureStrategy).toHaveBeenCalledTimes(1);
    const call = ensureStrategy.mock.calls[0]?.[0];
    expect(call?.definitionHash).toBe(hashLivefolioDefinition(definition));
    expect(call?.linkId).toBe(deriveLivefolioLinkId(call!.definitionHash));
    expect(result.strategyId).toBe(42);
    expect(result.definitionHash).toBe(call?.definitionHash);
  });
});
