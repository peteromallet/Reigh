import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboardingFlow } from './useOnboardingFlow';

const {
  navigateMock,
  closeOnboardingModalMock,
  startTourMock,
  handleErrorMock,
  checkAstridDoctorAvailabilityMock,
  useUserUIStateMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  closeOnboardingModalMock: vi.fn(),
  startTourMock: vi.fn(),
  handleErrorMock: vi.fn(),
  checkAstridDoctorAvailabilityMock: vi.fn(),
  useUserUIStateMock: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/integrations/astrid/doctorAvailability.ts', () => ({
  checkAstridDoctorAvailability: checkAstridDoctorAvailabilityMock,
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: handleErrorMock,
}));

vi.mock('@/shared/hooks/useOnboarding', () => ({
  useOnboarding: () => ({
    showOnboardingModal: false,
    closeOnboardingModal: closeOnboardingModalMock,
  }),
}));

vi.mock('@/shared/hooks/useUserUIState', () => ({
  useUserUIState: useUserUIStateMock,
}));

vi.mock('@/shared/hooks/useProductTour', () => ({
  useProductTour: () => ({
    startTour: startTourMock,
  }),
}));

describe('useOnboardingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    checkAstridDoctorAvailabilityMock.mockResolvedValue({ status: 'available' });
  });

  it('closes, checks Astrid, enters the local tool, and starts the tour', async () => {
    const { result, unmount } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.handleOnboardingClose();
    });

    expect(closeOnboardingModalMock).toHaveBeenCalledTimes(1);
    expect(checkAstridDoctorAvailabilityMock).toHaveBeenCalledTimes(1);
    expect(result.current.doctorAvailability).toEqual({ status: 'available' });
    expect(navigateMock).toHaveBeenCalledWith('/tools/travel-between-images');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(startTourMock).toHaveBeenCalledTimes(1);
    expect(handleErrorMock).not.toHaveBeenCalled();

    unmount();
    vi.useRealTimers();
  });

  it('surfaces the doctor recovery action and does not enter the tool when unavailable', async () => {
    checkAstridDoctorAvailabilityMock.mockResolvedValue({
      status: 'unavailable',
      reason: 'connection refused',
    });
    const { result, unmount } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.handleOnboardingClose();
    });

    expect(result.current.doctorAvailability).toEqual({
      status: 'unavailable',
      reason: 'connection refused',
    });
    expect(handleErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('python3 -m astrid doctor --json'),
      }),
      {
        context: 'useOnboardingFlow.doctorUnavailable',
        showToast: true,
      },
    );
    expect(closeOnboardingModalMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(startTourMock).not.toHaveBeenCalled();

    unmount();
    vi.useRealTimers();
  });

  it('cancels a pending tour start on unmount', async () => {
    const { result, unmount } = renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.handleOnboardingClose();
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(startTourMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
