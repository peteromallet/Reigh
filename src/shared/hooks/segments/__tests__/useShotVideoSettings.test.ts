import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@/test/test-utils';

const mockSingle = vi.fn();
const mockIsDeferredCloudDataAuthority = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: () => mockSingle(),
        })),
      })),
    })),
  }),
}));

vi.mock('@/app/runtime/dataAuthority.ts', () => ({
  isDeferredCloudDataAuthority: mockIsDeferredCloudDataAuthority,
}));

vi.mock('@/shared/lib/settingsMigration', () => ({
  readShotSettings: vi.fn((raw: unknown) => raw),
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: vi.fn(),
}));

vi.mock('@/shared/lib/tooling/toolIds', () => ({
  TOOL_IDS: { TRAVEL_BETWEEN_IMAGES: 'travel-between-images' },
}));

import { useShotVideoSettings } from '../useShotVideoSettings';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';

describe('useShotVideoSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeferredCloudDataAuthority.mockReturnValue(true);
  });

  it('returns null data when shotId is null', () => {
    const { result } = renderHookWithProviders(() => useShotVideoSettings(null));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('does not start a Supabase read in Astrid authority', () => {
    mockIsDeferredCloudDataAuthority.mockReturnValue(false);
    const { result } = renderHookWithProviders(() => useShotVideoSettings('shot-1'));
    expect(result.current.isLoading).toBe(false);
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it('fetches settings when shotId is provided', async () => {
    mockSingle.mockResolvedValue({
      data: {
        settings: {
          'travel-between-images': { numFrames: 25, prompt: 'test' },
        },
      },
      error: null,
    });

    const { result } = renderHookWithProviders(() => useShotVideoSettings('shot-1'));

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
  });

  it('surfaces query errors consistently', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });

    const { result } = renderHookWithProviders(() => useShotVideoSettings('shot-1'));

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
    expect(result.current.data).toBeUndefined();
    expect(normalizeAndPresentError).toHaveBeenCalledTimes(1);
  });

  it('provides refetch function', () => {
    const { result } = renderHookWithProviders(() => useShotVideoSettings('shot-1'));
    expect(typeof result.current.refetch).toBe('function');
  });
});
