import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHookWithProviders } from '@/test/test-utils';

const mockShotsData = [
  { id: 'shot-1', name: 'Shot 1', position: 0, project_id: 'proj-1' },
  { id: 'shot-2', name: 'Shot 2', position: 1, project_id: 'proj-1' },
];

const mockShotGenerations = [
  {
    id: 'sg-1',
    shot_id: 'shot-1',
    timeline_frame: 0,
    generation_id: 'gen-1',
    generation: {
      id: 'gen-1',
      location: 'test.jpg',
      thumbnail_url: 'thumb.jpg',
      type: 'image',
      created_at: '2025-01-01',
      starred: false,
      name: null,
      based_on: null,
      params: {},
      primary_variant_id: null,
      primary_variant: null,
    },
  },
];

const mockNot = vi.fn();
const mockSupabaseFrom = vi.hoisted(() => vi.fn());
const mockIsDeferredCloudDataAuthority = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: vi.fn((table: string) => {
      mockSupabaseFrom(table);
      if (table === 'shots') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: mockShotsData, error: null })),
              not: mockNot,
            })),
          })),
        };
      }
      if (table === 'shot_generations') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() =>
                  Promise.resolve({ data: mockShotGenerations, error: null })
                ),
              })),
            })),
          })),
        };
      }
      if (table === 'generations') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              not: vi.fn(() => ({
                or: vi.fn(() => Promise.resolve({ count: 0, error: null })),
              })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      };
    }),
  }),
}));

vi.mock('@/app/runtime/dataAuthority.ts', () => ({
  isDeferredCloudDataAuthority: mockIsDeferredCloudDataAuthority,
}));

vi.mock('../mappers', () => ({
  mapShotGenerationToRow: vi.fn((sg: Record<string, unknown>) => {
    const gen = sg.generation as Record<string, unknown> | null;
    if (!gen) return null;
    return {
      id: gen.id,
      location: gen.location,
      thumbUrl: gen.thumbnail_url,
      type: gen.type,
      timeline_frame: sg.timeline_frame,
      isVideo: false,
    };
  }),
}));

vi.mock('@/shared/lib/mediaTypeHelpers', () => ({
  getGenerationId: vi.fn((media: { id: string }) => media.id),
}));

import { useListShots, useProjectImageStats } from '../useShotsQueries';

describe('useListShots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
  });

  it('is disabled when projectId is null', () => {
    const { result } = renderHookWithProviders(() => useListShots(null));
    expect(result.current.isFetching).toBe(false);
  });

  it('is disabled when projectId is undefined', () => {
    const { result } = renderHookWithProviders(() => useListShots(undefined));
    expect(result.current.isFetching).toBe(false);
  });

  it('does not start a Supabase read in Astrid authority', () => {
    mockIsDeferredCloudDataAuthority.mockReturnValue(false);
    const { result } = renderHookWithProviders(() => useListShots('proj-1'));
    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });
});

describe('useProjectImageStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when projectId is null', () => {
    const { result } = renderHookWithProviders(() => useProjectImageStats(null));
    expect(result.current.isFetching).toBe(false);
  });

  it('is disabled when projectId is undefined', () => {
    const { result } = renderHookWithProviders(() => useProjectImageStats(undefined));
    expect(result.current.isFetching).toBe(false);
  });
});
