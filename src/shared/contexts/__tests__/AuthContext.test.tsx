/**
 * AuthContext Tests
 *
 * Tests for authentication state management context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Use vi.hoisted for variables referenced inside vi.mock factories
const { mockGetSession, mockOnAuthStateChange, getAuthStateManagerMock } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  getAuthStateManagerMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}));

vi.mock('@/integrations/supabase/auth/AuthStateManager', () => ({
  getAuthStateManager: () => getAuthStateManagerMock(),
}));

import { AuthProvider, useAuth } from '../AuthContext';

// Test consumer component
function AuthConsumer() {
  const { userId, isAuthenticated, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="userId">{userId ?? 'null'}</span>
      <span data-testid="isAuthenticated">{String(isAuthenticated)}</span>
      <span data-testid="isLoading">{String(isLoading)}</span>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    getAuthStateManagerMock.mockReturnValue(null);

    // Default mock: no session
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: { unsubscribe: vi.fn() },
      },
    });
  });

  describe('useAuth hook', () => {
    it('throws when used outside AuthProvider', () => {
      // Suppress console.error from the expected error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      function BadConsumer() {
        useAuth();
        return null;
      }

      expect(() => {
        render(<BadConsumer />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('AuthProvider', () => {
    it('is immediately anonymous and never initializes auth in localTest mode', () => {
      window.history.replaceState({}, '', '/tools/video-editor?localTest=1');

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      expect(screen.getByTestId('userId')).toHaveTextContent('null');
      expect(mockGetSession).not.toHaveBeenCalled();
      expect(mockOnAuthStateChange).not.toHaveBeenCalled();
      expect(getAuthStateManagerMock).not.toHaveBeenCalled();
    });

    it('renders children', async () => {
      render(
        <AuthProvider>
          <div data-testid="child">Hello</div>
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('child')).toHaveTextContent('Hello');
      });
    });

    it('starts in loading state', () => {
      // Make getSession hang (never resolve)
      mockGetSession.mockReturnValue(new Promise(() => {}));

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      expect(screen.getByTestId('isLoading')).toHaveTextContent('true');
    });

    it('provides null userId when no session', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      });

      expect(screen.getByTestId('userId')).toHaveTextContent('null');
      expect(screen.getByTestId('isAuthenticated')).toHaveTextContent('false');
    });

    it('provides userId when session exists', async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: { user: { id: 'user-123' } },
        },
      });

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      });

      expect(screen.getByTestId('userId')).toHaveTextContent('user-123');
      expect(screen.getByTestId('isAuthenticated')).toHaveTextContent('true');
    });

    it('subscribes to auth state changes via fallback listener', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      });

      expect(mockOnAuthStateChange).toHaveBeenCalledWith(expect.any(Function));
    });

    it('uses auth manager when available', async () => {
      const mockSubscribe = vi.fn().mockReturnValue(() => {});
      getAuthStateManagerMock.mockReturnValue({
        subscribe: mockSubscribe,
      });

      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      });

      expect(mockSubscribe).toHaveBeenCalledWith('AuthContext', expect.any(Function));
      expect(mockOnAuthStateChange).not.toHaveBeenCalled();
    });
  });
});
