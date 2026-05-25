import { describe, it, expect } from 'vitest';
import { nextLotId } from './ids';

describe('nextLotId', () => {
  it('produces unique monotonically-increasing lot_N ids', () => {
    const a = nextLotId();
    const b = nextLotId();
    expect(a).toMatch(/^lot_\d+$/);
    expect(b).toMatch(/^lot_\d+$/);
    expect(a).not.toBe(b);
  });
});
