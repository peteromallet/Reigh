import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockGetUser, mockSingle } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSingle: vi.fn(),
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
  updateToolSettingsSupabase: vi.fn().mockResolvedValue(undefined),
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
  });

  afterEach(() => {
    vi.useRealTimers();
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
