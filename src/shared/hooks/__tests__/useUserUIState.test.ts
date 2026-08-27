import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockGetUser, mockSingle, mockUpdateToolSettings } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSingle: vi.fn(),
  mockUpdateToolSettings: vi.fn().mockResolvedValue(undefined),
}));
const { isDeferredCloudDataAuthorityMock } = vi.hoisted(() => ({
  isDeferredCloudDataAuthorityMock: vi.fn(() => true),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: mockSingle,
        })),
      })),
    })),
  }),
}));

vi.mock('@/shared/hooks/settings/useToolSettings', () => ({
  updateToolSettingsSupabase: mockUpdateToolSettings,
}));

vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: isDeferredCloudDataAuthorityMock,
}));

import {
  _resetUserUIStateCacheForTesting,
  useUserUIState,
} from '../useUserUIState';

describe('useUserUIState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    _resetUserUIStateCacheForTesting();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          ui: {
            paneLocks: { shots: false, tasks: false, gens: false, editor: false },
            theme: { darkMode: true },
          },
        },
      },
      error: null,
    });
    isDeferredCloudDataAuthorityMock.mockReturnValue(true);
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('keeps local-test preferences deterministic without initializing Supabase', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localTest=1');
    const fallback = { darkMode: true };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.value).toEqual(fallback);
    expect(mockGetUser).not.toHaveBeenCalled();

    act(() => {
      result.current.update({ darkMode: false });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.value).toEqual({ darkMode: false });
    expect(mockUpdateToolSettings).not.toHaveBeenCalled();
  });

  it('keeps Astrid-authority preferences local without loading or writing Supabase', async () => {
    isDeferredCloudDataAuthorityMock.mockReturnValue(false);
    const fallback = { darkMode: true };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.value).toEqual(fallback);
    expect(mockGetUser).not.toHaveBeenCalled();

    act(() => {
      result.current.update({ darkMode: false });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.value).toEqual({ darkMode: false });
    expect(mockUpdateToolSettings).not.toHaveBeenCalled();
  });

  it('returns fallback value initially', () => {
    const fallback = { darkMode: true };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    expect(result.current.value).toEqual(fallback);
    expect(result.current.isLoading).toBe(true);
    expect(typeof result.current.update).toBe('function');
  });

  it('deduplicates concurrent getUser() calls across simultaneous mounts', async () => {
    let resolveGetUser!: (value: { data: { user: { id: string } | null } }) => void;
    mockGetUser.mockReturnValue(new Promise((resolve) => {
      resolveGetUser = resolve;
    }));

    const fallback = { darkMode: true };
    const { result: first } = renderHook(() => useUserUIState('theme', fallback));
    const { result: second } = renderHook(() => useUserUIState('theme', fallback));

    // getUser() is still pending — both mounts must share the single in-flight call.
    expect(mockGetUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveGetUser({ data: { user: { id: 'user-1' } } });
      await vi.runAllTimersAsync();
    });

    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(first.current.isLoading).toBe(false);
    expect(second.current.isLoading).toBe(false);
  });

  it('loads value from database', async () => {
    const fallback = { darkMode: false };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.value.darkMode).toBe(true);
  });

  it('uses fallback when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const fallback = { darkMode: true };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.value).toEqual(fallback);
  });

  it('is completely local and does not read or write Supabase in Astrid editor mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline');

    const fallback = { darkMode: true };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.value).toEqual(fallback);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockSingle).not.toHaveBeenCalled();

    act(() => {
      result.current.update({ darkMode: false });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.value.darkMode).toBe(false);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it('update changes local value immediately', async () => {
    const fallback = { darkMode: true };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      result.current.update({ darkMode: false });
    });

    expect(result.current.value.darkMode).toBe(false);
  });

  it('uses fallback when database returns error', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });

    const fallback = { darkMode: true };
    const { result } = renderHook(() => useUserUIState('theme', fallback));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('normalizes generationMethods when both are true', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          ui: {
            generationMethods: { inCloud: true, onComputer: true },
          },
        },
      },
      error: null,
    });

    const fallback = { inCloud: true, onComputer: false };
    const { result } = renderHook(() =>
      useUserUIState('generationMethods', fallback)
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Should normalize: both true → inCloud: true, onComputer: false
    expect(result.current.value.inCloud).toBe(true);
    expect(result.current.value.onComputer).toBe(false);
  });

  it('falls back when persisted aiInputMode JSON is invalid', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          ui: {
            aiInputMode: { mode: 'none' },
          },
        },
      },
      error: null,
    });

    const fallback = { mode: 'voice' as const };
    const { result } = renderHook(() =>
      useUserUIState('aiInputMode', fallback)
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.value.mode).toBe('voice');
  });
});
