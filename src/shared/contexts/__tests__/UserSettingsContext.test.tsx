/**
 * UserSettingsContext Tests
 *
 * Tests for user settings state management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useState } from 'react';

// Use vi.hoisted for variables referenced inside vi.mock factories
const {
  mockGetUserId,
  mockSupabaseSelect,
  mockUpdateToolSettings,
  isDeferredCloudDataAuthorityMock,
} = vi.hoisted(() => ({
  mockGetUserId: vi.fn().mockReturnValue('user-123'),
  mockSupabaseSelect: vi.fn(),
  mockUpdateToolSettings: vi.fn().mockResolvedValue(undefined),
  isDeferredCloudDataAuthorityMock: vi.fn().mockReturnValue(true),
}));

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ userId: mockGetUserId() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: mockSupabaseSelect,
        }),
      }),
    }),
  }),
}));

vi.mock('@/shared/hooks/settings/useToolSettings', () => ({
  updateToolSettingsSupabase: mockUpdateToolSettings,
}));

vi.mock('@/shared/hooks/useMobileTimeoutFallback', () => ({
  useMobileTimeoutFallback: vi.fn(),
}));

vi.mock('@/app/runtime/dataAuthority', () => ({
  isDeferredCloudDataAuthority: isDeferredCloudDataAuthorityMock,
}));

import { UserSettingsProvider, useUserSettings } from '../UserSettingsContext';

// Test consumer
function SettingsConsumer() {
  const { userSettings, isLoadingSettings } = useUserSettings();
  return (
    <div>
      <span data-testid="isLoading">{String(isLoadingSettings)}</span>
      <span data-testid="settings">{JSON.stringify(userSettings ?? 'undefined')}</span>
    </div>
  );
}

describe('UserSettingsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserId.mockReturnValue('user-123');
    isDeferredCloudDataAuthorityMock.mockReturnValue(true);
    mockSupabaseSelect.mockResolvedValue({
      data: {
        settings: {
          'user-preferences': { theme: 'dark', lastProject: 'proj-1' },
        },
      },
      error: null,
    });
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  describe('useUserSettings hook', () => {
    it('throws when used outside UserSettingsProvider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      function BadConsumer() {
        useUserSettings();
        return null;
      }

      expect(() => {
        render(<BadConsumer />);
      }).toThrow('useUserSettings must be used within a UserSettingsProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('UserSettingsProvider', () => {
    it('renders children', async () => {
      render(
        <UserSettingsProvider>
          <div data-testid="child">Hello</div>
        </UserSettingsProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Hello');
    });

    it('fetches user settings on mount when userId is available', async () => {
      render(
        <UserSettingsProvider>
          <SettingsConsumer />
        </UserSettingsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      });

      expect(screen.getByTestId('settings')).toHaveTextContent('"theme":"dark"');
    });

    it('provides undefined settings when no userId', async () => {
      mockGetUserId.mockReturnValue(null);

      render(
        <UserSettingsProvider>
          <SettingsConsumer />
        </UserSettingsProvider>
      );

      // Should not be loading and settings should be undefined
      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      expect(screen.getByTestId('settings')).toHaveTextContent('undefined');
    });

    it('does not read or write Supabase in local Astrid editor mode', async () => {
      window.history.replaceState({}, '', '/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline');

      function UpdateConsumer() {
        const { updateUserSettings } = useUserSettings();
        return (
          <button
            data-testid="local-update"
            onClick={() => void updateUserSettings('user', { theme: 'light' } as Record<string, unknown>)}
          >
            Update
          </button>
        );
      }

      render(
        <UserSettingsProvider>
          <SettingsConsumer />
          <UpdateConsumer />
        </UserSettingsProvider>,
      );

      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      expect(screen.getByTestId('settings')).toHaveTextContent('undefined');

      await act(async () => {
        screen.getByTestId('local-update').click();
      });

      expect(mockSupabaseSelect).not.toHaveBeenCalled();
      expect(mockUpdateToolSettings).not.toHaveBeenCalled();
    });

    it('does not read or write Supabase under default Astrid authority', async () => {
      isDeferredCloudDataAuthorityMock.mockReturnValue(false);

      function UpdateConsumer() {
        const { updateUserSettings } = useUserSettings();
        return (
          <button
            data-testid="astrid-update"
            onClick={() => void updateUserSettings('user', { theme: 'light' } as Record<string, unknown>)}
          >
            Update
          </button>
        );
      }

      render(
        <UserSettingsProvider>
          <SettingsConsumer />
          <UpdateConsumer />
        </UserSettingsProvider>,
      );

      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      expect(screen.getByTestId('settings')).toHaveTextContent('undefined');

      await act(async () => {
        screen.getByTestId('astrid-update').click();
      });

      expect(mockSupabaseSelect).not.toHaveBeenCalled();
      expect(mockUpdateToolSettings).not.toHaveBeenCalled();
    });

    it('sets empty settings on fetch error', async () => {
      mockSupabaseSelect.mockResolvedValue({
        data: null,
        error: new Error('Database error'),
      });

      render(
        <UserSettingsProvider>
          <SettingsConsumer />
        </UserSettingsProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      });

      expect(screen.getByTestId('settings')).toHaveTextContent('{}');
    });

    it('provides updateUserSettings function', async () => {
      function UpdateConsumer() {
        const { updateUserSettings } = useUserSettings();
        return (
          <button
            data-testid="update"
            onClick={() => updateUserSettings('user', { theme: 'light' } as Record<string, unknown>)}
          >
            Update
          </button>
        );
      }

      render(
        <UserSettingsProvider>
          <UpdateConsumer />
        </UserSettingsProvider>
      );

      await waitFor(() => {
        // Wait for initial fetch to complete
      });

      await act(async () => {
        screen.getByTestId('update').click();
      });

      expect(mockUpdateToolSettings).toHaveBeenCalledWith({
        scope: 'user',
        id: 'user-123',
        toolId: 'user-preferences',
        patch: { theme: 'light' },
      });
    });

    it('surfaces auth failure when updating user settings while signed out', async () => {
      mockGetUserId.mockReturnValue(null);

      function UpdateConsumer() {
        const { updateUserSettings } = useUserSettings();
        const [errorMessage, setErrorMessage] = useState('');

        return (
          <>
            <button
              data-testid="update-signed-out"
              onClick={() => {
                void updateUserSettings('user', { theme: 'light' } as Record<string, unknown>)
                  .catch((error: Error) => setErrorMessage(error.message));
              }}
            >
              Update
            </button>
            <span data-testid="error-message">{errorMessage}</span>
          </>
        );
      }

      render(
        <UserSettingsProvider>
          <UpdateConsumer />
        </UserSettingsProvider>
      );

      await act(async () => {
        screen.getByTestId('update-signed-out').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent(
          'Authentication required for user settings update',
        );
      });
      expect(mockUpdateToolSettings).not.toHaveBeenCalled();
    });
  });
});
