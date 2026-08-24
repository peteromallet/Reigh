import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inspectAstridCapabilitiesMock } = vi.hoisted(() => ({
  inspectAstridCapabilitiesMock: vi.fn(),
}));

vi.mock('./capabilityCensus.ts', () => ({
  inspectAstridCapabilities: inspectAstridCapabilitiesMock,
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
    inspectAstridCapabilitiesMock.mockResolvedValue({
      health: 'available',
      readiness: 'ready',
      capabilities: { tasks: 'supported', generations: 'supported', media: 'supported' },
      reasons: {},
    });

    await expect(checkAstridDoctorAvailability()).resolves.toEqual({ status: 'available' });
    expect(inspectAstridCapabilitiesMock).toHaveBeenCalledWith('/api/astrid');
  });

  it('preserves the bridge failure reason for explicit recovery UX', async () => {
    inspectAstridCapabilitiesMock.mockResolvedValue({
      health: 'unavailable',
      readiness: 'unavailable',
      capabilities: { tasks: 'unknown', generations: 'unknown', media: 'unknown' },
      reasons: { health: 'connection refused' },
    });

    await expect(checkAstridDoctorAvailability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'connection refused',
    });
    expect(ASTRID_DOCTOR_COMMAND).toBe('python3 -m astrid doctor --json');
  });

  it('does not call a healthy bridge ready when required routes are absent', async () => {
    inspectAstridCapabilitiesMock.mockResolvedValue({
      health: 'available',
      readiness: 'degraded',
      capabilities: { tasks: 'unavailable', generations: 'unavailable', media: 'unknown' },
      reasons: { tasks: 'unknown route: tasks' },
    });

    await expect(checkAstridDoctorAvailability()).resolves.toEqual({
      status: 'degraded',
      unavailable: ['tasks', 'generations'],
      unknown: ['media'],
      reason: 'unknown route: tasks',
    });
  });
});
