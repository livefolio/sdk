import { describe, it, expect } from 'vitest';
import { backtest } from './backtest';

describe('backtest', () => {
  it('throws "Not implemented"', async () => {
    await expect(
      backtest(
        { linkId: 'x', name: 'x', trading: { frequency: 'Daily', offset: 0 }, allocations: [], signals: [] },
        { startDate: '2020-01-01', endDate: '2025-01-01' },
      ),
    ).rejects.toThrow('Not implemented');
  });
});
