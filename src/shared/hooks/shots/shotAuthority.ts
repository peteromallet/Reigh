import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority.ts';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';

/**
 * Relational shot routes are an explicitly deferred cloud capability. Keep
 * this assertion at the operation boundary so callers fail before a Supabase
 * client/repository call or optimistic cache effect can run in Astrid mode.
 */
export function assertDeferredCloudShotOperation(operation: string): void {
  if (isDeferredCloudDataAuthority()) {
    return;
  }

  throw bridgeCapabilityUnavailable(
    operation,
    'Use an Astrid pack command after shot routes are installed.',
  );
}
