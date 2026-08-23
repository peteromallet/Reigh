/**
 * AuthContext Tests — boot/auth seam over the bridge probe.
 *
 * The provider resolves the fixed local user from a single
 * `/api/astrid/health` probe per boot (no Supabase session machinery).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { probeBridgeSessionMock } = vi.hoisted(() => ({
  probeBridgeSessionMock: vi.fn(),
}));

vi.mock('@/shared/auth/bridgeSession', () => ({
  probeBridgeSession: probeBridgeSessionMock,
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
    probeBridgeSessionMock.mockReset();
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
    it('renders children', async () => {
      probeBridgeSessionMock.mockResolvedValue({ ok: true, userId: 'local-user' });

      render(
        <AuthProvider>
          <div data-testid="child">Hello</div>
        </AuthProvider>
      );
      await waitFor(() => {
        expect(screen.getByTestId('child')).toHaveTextContent('Hello');
      });
    });

    it('starts in loading state while probing', () => {
      // A probe that never settles: isLoading must stay true.
      probeBridgeSessionMock.mockReturnValue(
        new Promise<{ ok: true; userId: string }>(() => {}),
      );

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      expect(screen.getByTestId('isLoading')).toHaveTextContent('true');
      expect(screen.getByTestId('userId')).toHaveTextContent('null');
    });

    it('resolves the fixed local user after a healthy probe', async () => {
      probeBridgeSessionMock.mockResolvedValue({ ok: true, userId: 'local-user' });

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
      });

      expect(screen.getByTestId('userId')).toHaveTextContent('local-user');
      expect(screen.getByTestId('isAuthenticated')).toHaveTextContent('true');
    });

    it('exposes an honest failure state when the probe fails — no retry loop', async () => {
      probeBridgeSessionMock.mockResolvedValue({ ok: false, reason: 'bridge unreachable' });

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

      // One probe per boot: failure is terminal for this mount, never retried.
      await waitFor(() => {
        expect(probeBridgeSessionMock).toHaveBeenCalledTimes(1);
      });
    });
  });
});
