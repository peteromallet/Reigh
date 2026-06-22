import { describe, expect, it } from 'vitest';

describe('test suite', () => {
  it('test 1', () => { expect(1).toBe(1); });
  it('test 2', () => { expect(2).toBe(2); });
  it('test 3', () => { expect(3).toBe(3); });
  describe('nested suite', () => {
    it('nested 1', () => { expect(4).toBe(4); });
    it('nested 2', () => { expect(5).toBe(5); });
  });
});
