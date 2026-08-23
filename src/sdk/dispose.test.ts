import { describe, expect, it } from 'vitest';
import { combineDisposeHandles } from './index';

describe('combineDisposeHandles', () => {
  it('disposes registrations in reverse order exactly once', () => {
    const calls: string[] = [];
    const combined = combineDisposeHandles(
      { dispose: () => { calls.push('first'); } },
      undefined,
      { dispose: () => { calls.push('second'); } },
    );

    combined.dispose();
    combined.dispose();

    expect(calls).toEqual(['second', 'first']);
  });

  it('supports explicit resource management through the same idempotent path', () => {
    let calls = 0;
    const combined = combineDisposeHandles({ dispose: () => { calls += 1; } });

    combined[Symbol.dispose]?.();
    combined.dispose();

    expect(calls).toBe(1);
  });
});
