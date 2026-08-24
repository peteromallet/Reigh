/**
 * Browser-side availability check for Astrid's doctor-owned local setup.
 *
 * The frozen HTTP bridge exposes liveness at `/health`, not the full CLI
 * doctor report. This probe therefore answers only whether the local runtime
 * is available. Detailed remediation remains owned by the read-only
 * `python3 -m astrid doctor --json` command.
 */

import {
  BRIDGE_PROBE_BASE_URL,
  probeBridgeSession,
} from '@/shared/auth/bridgeSession.ts';

export const ASTRID_DOCTOR_COMMAND = 'python3 -m astrid doctor --json';

export type AstridDoctorAvailability =
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'unavailable'; reason: string };

export async function checkAstridDoctorAvailability(
  baseUrl: string = BRIDGE_PROBE_BASE_URL,
): Promise<Exclude<AstridDoctorAvailability, { status: 'checking' }>> {
  const result = await probeBridgeSession(baseUrl);
  return result.ok
    ? { status: 'available' }
    : { status: 'unavailable', reason: result.reason };
}
