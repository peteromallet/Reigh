import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateRunId } from './ids';

describe('generateRunId', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes the UTC timestamp as digits without punctuation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T19:17:42.031Z'));

    expect(generateRunId()).toBe('20260823191742031');
  });
});
