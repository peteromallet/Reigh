import { beforeEach, describe, expect, it, vi } from 'vitest';

const { probeBridgeSessionMock } = vi.hoisted(() => ({
  probeBridgeSessionMock: vi.fn(),
}));

vi.mock('@/shared/auth/bridgeSession.ts', () => ({
  BRIDGE_PROBE_BASE_URL: '/api/astrid',
  probeBridgeSession: probeBridgeSessionMock,
}));

import {
  ASTRID_DOCTOR_COMMAND,
  checkAstridDoctorAvailability,
} from './doctorAvailability.ts';

describe('checkAstridDoctorAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the doctor-owned local runtime as available after a healthy bridge probe', async () => {
    probeBridgeSessionMock.mockResolvedValue({ ok: true, userId: 'local-user' });

    await expect(checkAstridDoctorAvailability()).resolves.toEqual({ status: 'available' });
    expect(probeBridgeSessionMock).toHaveBeenCalledWith('/api/astrid');
  });

  it('preserves the bridge failure reason for explicit recovery UX', async () => {
    probeBridgeSessionMock.mockResolvedValue({ ok: false, reason: 'connection refused' });

    await expect(checkAstridDoctorAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'connection refused',
    });
    expect(ASTRID_DOCTOR_COMMAND).toBe('python3 -m astrid doctor --json');
  });
});
