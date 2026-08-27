import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const {
  mockGetUser,
  mockSelect,
  mockUpdate,
  mockGetSupabaseClient,
  isDeferredCloudDataAuthorityMock,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
  isDeferredCloudDataAuthorityMock: vi.fn().mockReturnValue(true),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: mockGetSupabaseClient,
}));

vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: isDeferredCloudDataAuthorityMock,
}));

import { useOnboarding } from '../useOnboarding';

describe('useOnboarding', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    isDeferredCloudDataAuthorityMock.mockReturnValue(true);
    window.history.replaceState({}, '', '/');
    mockGetSupabaseClient.mockReturnValue({
      auth: {
        getUser: () => mockGetUser(),
      },
      from: vi.fn((_table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: () => mockSelect(),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => mockUpdate()),
        })),
      })),
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('does not show modal initially', () => {
    mockSelect.mockResolvedValue({ data: { onboarding_completed: true }, error: null });
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.showOnboardingModal).toBe(false);
  });

  it('never initializes Supabase in deterministic local-test mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localTest=1');
    const { result } = renderHook(() => useOnboarding());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.showOnboardingModal).toBe(false);
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();

    act(() => result.current.closeOnboardingModal());
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  it('shows modal when onboarding not completed after delay', async () => {
    mockSelect.mockResolvedValue({ data: { onboarding_completed: false }, error: null });
    const { result } = renderHook(() => useOnboarding());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.showOnboardingModal).toBe(true);
  });

  it('does not show modal when no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useOnboarding());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.showOnboardingModal).toBe(false);
  });

  it('does not probe Supabase in local Astrid editor mode', async () => {
    window.history.replaceState({}, '', '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline');

    const { result } = renderHook(() => useOnboarding());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.showOnboardingModal).toBe(false);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('does not probe Supabase under default Astrid authority', async () => {
    isDeferredCloudDataAuthorityMock.mockReturnValue(false);
    const { result } = renderHook(() => useOnboarding());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.showOnboardingModal).toBe(false);
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();

    act(() => result.current.closeOnboardingModal());
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  it('closeOnboardingModal hides modal', async () => {
    mockSelect.mockResolvedValue({ data: { onboarding_completed: false }, error: null });
    mockUpdate.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useOnboarding());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.showOnboardingModal).toBe(true);

    act(() => {
      result.current.closeOnboardingModal();
    });

    expect(result.current.showOnboardingModal).toBe(false);
  });

});
