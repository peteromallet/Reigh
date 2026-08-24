import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRow } from '@/domains/generation/types';
import { useSegmentBadge } from './useSegmentBadge';

const markAllViewed = vi.fn();
const getBadgeData = vi.fn();

vi.mock('@/shared/hooks/variants/useMarkVariantViewed', () => ({
  useMarkVariantViewed: () => ({ markAllViewed }),
}));

vi.mock('@/shared/hooks/variants/useVariantBadges', () => ({
  useVariantBadges: () => ({ getBadgeData }),
}));

const baseChild: GenerationRow = {
  id: 'gen-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('useSegmentBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks new items when recently created with no variants', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:09:00.000Z').getTime());
    getBadgeData.mockReturnValue({ derivedCount: 0, hasUnviewedVariants: false, unviewedVariantCount: 0 });

    const { result } = renderHook(() => useSegmentBadge(baseChild));

    expect(result.current.showNewBadge).toBe(true);
    expect(result.current.isNewWithNoVariants).toBe(true);
    expect(result.current.unviewedCount).toBe(1);
  });

  it('uses unviewed variant counts and forwards mark-all callback', () => {
    getBadgeData.mockReturnValue({ derivedCount: 2, hasUnviewedVariants: true, unviewedVariantCount: 3 });

    const { result } = renderHook(() => useSegmentBadge(baseChild));

    expect(result.current.showNewBadge).toBe(true);
    expect(result.current.isNewWithNoVariants).toBe(false);
    expect(result.current.unviewedCount).toBe(3);

    result.current.onMarkAllViewed();
    expect(markAllViewed).toHaveBeenCalledWith('gen-1');
  });
});
