import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/test-utils';

const { mockSelect, mockInsert, mockUpdateDb, mockDeleteDb, mockGetUser } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdateDb: vi.fn(),
  mockDeleteDb: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            range: vi.fn(() => mockSelect()),
            maybeSingle: vi.fn(() => mockSelect()),
          })),
          range: vi.fn(() => mockSelect()),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: mockInsert,
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: mockUpdateDb,
            })),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => mockDeleteDb()),
        })),
      })),
    })),
  }),
}));

vi.mock('@/shared/lib/query/queryDefaults', () => ({
  QUERY_PRESETS: {
    static: { staleTime: Infinity },
  },
}));

// This suite exercises the Supabase-backed resource hooks. Phase C defaults
// the application to Astrid authority, so opt this test boundary into the
// explicitly deferred cloud surface rather than depending on ambient env.
vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: () => true,
}));

import {
  useListPublicResources,
  useListResources,
  useCreateResource,
  useDeleteResource,
  usePublicLoras,
} from '@/features/resources/hooks/useResources';

describe('useListPublicResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue({ data: [], error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('fetches public resources for a type', async () => {
    mockSelect.mockResolvedValue({
      data: [
        { id: 'r-1', type: 'lora', metadata: { Name: 'Test LoRA' }, is_public: true },
      ],
      error: null,
    });

    const { result } = renderHookWithProviders(() =>
      useListPublicResources('lora')
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
  });

  it('handles fetch error', async () => {
    mockSelect.mockResolvedValue({
      data: null,
      error: { message: 'Fetch failed' },
    });

    const { result } = renderHookWithProviders(() =>
      useListPublicResources('lora')
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useListResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue({ data: [], error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('fetches user resources for a type', async () => {
    const { result } = renderHookWithProviders(() =>
      useListResources('style-reference')
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });
});

describe('useCreateResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('returns a mutation', () => {
    const { result } = renderHookWithProviders(() => useCreateResource());

    expect(typeof result.current.mutateAsync).toBe('function');
    expect(result.current.isPending).toBe(false);
  });
});

describe('useDeleteResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('returns a mutation', () => {
    const { result } = renderHookWithProviders(() => useDeleteResource());

    expect(typeof result.current.mutateAsync).toBe('function');
    expect(result.current.isPending).toBe(false);
  });
});

describe('usePublicLoras', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue({ data: [], error: null });
  });

  it('extracts metadata from resources', async () => {
    mockSelect.mockResolvedValue({
      data: [
        {
          id: 'r-1',
          type: 'lora',
          metadata: { Name: 'LoRA 1', 'Model ID': 'lora-1' },
          is_public: true,
        },
      ],
      error: null,
    });

    const { result } = renderHookWithProviders(() => usePublicLoras());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]).toHaveProperty('Name', 'LoRA 1');
  });
});
