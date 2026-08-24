/**
 * Browser-side availability check for Astrid's doctor-owned local setup.
 *
 * The frozen HTTP bridge exposes liveness at `/health`, not the full CLI
 * doctor report. This probe therefore answers only whether the local runtime
 * is available. Detailed remediation remains owned by the read-only
 * `python3 -m astrid doctor --json` command.
 */

import { BRIDGE_PROBE_BASE_URL } from '@/shared/auth/bridgeSession.ts';
import {
  inspectAstridCapabilities,
  type AstridCapability,
} from './capabilityCensus.ts';

export const ASTRID_DOCTOR_COMMAND = 'python3 -m astrid doctor --json';

export type AstridDoctorAvailability =
  | { status: 'checking' }
  | { status: 'available' }
  | { status: 'degraded'; unavailable: AstridCapability[]; unknown: AstridCapability[]; reason: string }
  | { status: 'unavailable'; reason: string };

export async function checkAstridDoctorAvailability(
  baseUrl: string = BRIDGE_PROBE_BASE_URL,
): Promise<Exclude<AstridDoctorAvailability, { status: 'checking' }>> {
  const result = await inspectAstridCapabilities(baseUrl);
  if (result.health === 'unavailable') {
    return { status: 'unavailable', reason: result.reasons.health ?? 'bridge health unavailable' };
  }
  if (result.readiness === 'ready') return { status: 'available' };

  const capabilities = Object.entries(result.capabilities) as Array<[
    AstridCapability,
    (typeof result.capabilities)[AstridCapability],
  ]>;
  const unavailable = capabilities.filter(([, support]) => support === 'unavailable').map(([name]) => name);
  const unknown = capabilities.filter(([, support]) => support === 'unknown').map(([name]) => name);
  const reason = result.reasons.projects
    ?? [...unavailable, ...unknown].map((name) => result.reasons[name]).find(Boolean)
    ?? 'Some project-scoped capabilities could not be verified.';
  return { status: 'degraded', unavailable, unknown, reason };
}
