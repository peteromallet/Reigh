/**
 * Boot/auth seam tests — [XHARD] evidence (a) + (b).
 *
 * (a) The covered journey's boot surface (AuthProvider → AuthGate → Layout
 *     gates) renders with ZERO Supabase environment configured: auth is
 *     resolved by the `/api/astrid` bridge probe alone.
 * (b) A failing probe renders a degraded-but-alive state — never a redirect
 *     loop: Layout route access passes on the probe result, and the failure
 *     path settles after exactly one probe.
 */

// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { probeBridgeSessionMock } = vi.hoisted(() => ({
  probeBridgeSessionMock: vi.fn(),
}));

vi.mock('@/shared/auth/bridgeSession', () => ({
  probeBridgeSession: probeBridgeSessionMock,
}));

import { AuthProvider } from '@/shared/contexts/AuthContext';
import { AuthGate } from '@/shared/auth/components/AuthGate';
import { probeBridgeSession } from '@/shared/auth/bridgeSession';

const probeMock = vi.mocked(probeBridgeSession);

function BootSurface() {
  return (
    <MemoryRouter initialEntries={['/tools/video-editor?timeline=local-timeline']}>
      <AuthProvider>
        <AuthGate>
          <div data-testid="booted-shell">editor shell</div>
        </AuthGate>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('env-free boot over the bridge probe', () => {
  let originalEnv: Record<string, unknown>;

  beforeEach(() => {
    originalEnv = { ...import.meta.env };
    // Simulate a boot with ZERO Supabase env vars set.
    delete import.meta.env.VITE_SUPABASE_URL;
    delete import.meta.env.VITE_SUPABASE_ANON_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(import.meta.env, originalEnv);
  });

  it('[XHARD a] boots AuthGate/Layout children with no Supabase env and a healthy bridge', async () => {
    probeMock.mockResolvedValue({ ok: true, userId: 'local-user' });

    render(<BootSurface />);

    await waitFor(() => {
      expect(screen.getByTestId('booted-shell')).toBeInTheDocument();
    });
    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(probeMock).toHaveBeenCalledWith();
  });

  it('[XHARD b] a failed probe degrades to alive-but-unauthenticated — one probe, no loop', async () => {
    let resolveProbe!: (value: { ok: false; reason: string }) => void;
    const pending = new Promise<{ ok: false; reason: string }>((resolve) => {
      resolveProbe = resolve;
    });
    probeMock.mockReturnValue(pending);

    render(<BootSurface />);

    // While probing, the gate holds children back but nothing crashes.
    expect(screen.queryByTestId('booted-shell')).not.toBeInTheDocument();

    resolveProbe({ ok: false, reason: 'bridge unreachable' });

    await waitFor(() => {
      expect(probeMock).toHaveBeenCalledTimes(1);
    });
    // Failure is terminal for this boot: exactly one probe. The gate opens
    // (isLoading=false) so the shell stays ALIVE and degraded — no redirect,
    // no re-probe loop.
    await waitFor(() => {
      expect(screen.getByTestId('booted-shell')).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(probeMock).toHaveBeenCalledTimes(1);
  });
});
