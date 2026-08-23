import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock('@/shared/contexts/AuthContext', () => ({
  useAuthSafe: () => ({
    userId: 'user-1',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('@/shared/lib/taskTypeCache', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/taskTypeCache')>(
    '@/shared/lib/taskTypeCache',
  );
  return {
    ...actual,
    setTaskTypeConfigCache: vi.fn(),
  };
});

import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { taskQueryKeys } from '@/shared/lib/queryKeys/tasks';
import { setTaskTypeConfigCache } from '@/shared/lib/taskTypeCache';
import { useAllTaskTypesConfig, useTaskType } from '../useTaskType';

const mockedUseQuery = vi.mocked(useQuery);
const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);
const mockedSetTaskTypeConfigCache = vi.mocked(setTaskTypeConfigCache);

function setupSingleLookupResponse(response: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(response);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  mockedGetSupabaseClient.mockReturnValue({ from } as unknown as ReturnType<typeof getSupabaseClient>);
  return { from, select, eq, maybeSingle };
}

function setupAllTypesResponse(response: { data: unknown; error: unknown }) {
  const eq = vi.fn().mockResolvedValue(response);
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  mockedGetSupabaseClient.mockReturnValue({ from } as unknown as ReturnType<typeof getSupabaseClient>);
  return { from, select, eq };
}

describe('useTaskType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseQuery.mockImplementation((options: unknown) => options as never);
  });

  it('builds a disabled query when task type is empty', () => {
    const query = useTaskType('') as unknown as { enabled: boolean; queryKey: unknown[] };

    expect(mockedUseQuery).toHaveBeenCalledTimes(1);
    expect(query.enabled).toBe(false);
    expect(query.queryKey).toEqual(taskQueryKeys.type(''));
  });

  it('normalizes nullable flags in task type lookup', async () => {
    setupSingleLookupResponse({
      data: {
        id: 'type-1',
        name: 'video_generation',
        content_type: 'video',
        tool_type: 'tool',
        display_name: 'Video Generation',
        category: 'generation',
        is_visible: null,
        supports_progress: undefined,
      },
      error: null,
    });

    const query = useTaskType('video_generation') as unknown as {
      enabled: boolean;
      queryKey: unknown[];
      queryFn: () => Promise<Record<string, unknown> | null>;
    };

    expect(query.enabled).toBe(true);
    expect(query.queryKey).toEqual(taskQueryKeys.type('video_generation'));

    const data = await query.queryFn();
    expect(data).toEqual({
      id: 'type-1',
      name: 'video_generation',
      content_type: 'video',
      tool_type: 'tool',
      display_name: 'Video Generation',
      category: 'generation',
      is_visible: false,
      supports_progress: false,
    });
  });

  it('returns null and warns when task type lookup fails', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupSingleLookupResponse({
      data: null,
      error: { message: 'lookup failed' },
    });

    const query = useTaskType('unknown') as unknown as {
      queryFn: () => Promise<Record<string, unknown> | null>;
    };

    await expect(query.queryFn()).resolves.toBeNull();
    expect(warningSpy).toHaveBeenCalled();
  });
});

describe('useAllTaskTypesConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseQuery.mockImplementation((options: unknown) => options as never);
  });

  it('maps all task types by name and updates cache', async () => {
    setupAllTypesResponse({
      data: [
        {
          id: 'type-1',
          name: 'video_generation',
          content_type: 'video',
          tool_type: 'tool',
          display_name: 'Video Generation',
          category: 'generation',
          is_visible: null,
          supports_progress: null,
        },
      ],
      error: null,
    });

    const query = useAllTaskTypesConfig() as unknown as {
      queryKey: unknown[];
      queryFn: () => Promise<Record<string, Record<string, unknown>>>;
      refetchOnWindowFocus: boolean;
      refetchOnMount: boolean;
    };

    expect(query.queryKey).toEqual(taskQueryKeys.typesConfigAll);
    expect(query.refetchOnWindowFocus).toBe(false);
    expect(query.refetchOnMount).toBe(false);

    const config = await query.queryFn();
    expect(config).toEqual({
      video_generation: {
        id: 'type-1',
        name: 'video_generation',
        content_type: 'video',
        tool_type: 'tool',
        display_name: 'Video Generation',
        category: 'generation',
        is_visible: false,
        supports_progress: false,
      },
    });
    expect(mockedSetTaskTypeConfigCache).toHaveBeenCalledWith(config);
  });

  it('returns empty config when all-types query fails', async () => {
    setupAllTypesResponse({ data: null, error: { message: 'query failed' } });

    const query = useAllTaskTypesConfig() as unknown as {
      queryFn: () => Promise<Record<string, unknown>>;
    };

    await expect(query.queryFn()).resolves.toEqual({});
    expect(mockedSetTaskTypeConfigCache).not.toHaveBeenCalled();
  });
});
