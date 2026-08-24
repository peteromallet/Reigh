/**
 * A browser action that the frozen Astrid bridge does not expose.
 *
 * This is deliberately distinct from a transport failure: retrying the same
 * request cannot make an absent route appear. Callers surface the recovery
 * action instead of silently falling back to Supabase or pretending success.
 */
export class BridgeCapabilityUnavailableError extends Error {
  readonly code = 'capability_unavailable' as const;
  readonly recoveryAction: string;

  constructor(operation: string, recoveryAction: string) {
    super(`Astrid bridge capability unavailable: ${operation}. ${recoveryAction}`);
    this.name = 'BridgeCapabilityUnavailableError';
    this.recoveryAction = recoveryAction;
  }
}

export function bridgeCapabilityUnavailable(
  operation: string,
  recoveryAction: string,
): BridgeCapabilityUnavailableError {
  return new BridgeCapabilityUnavailableError(operation, recoveryAction);
}
