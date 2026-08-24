/**
 * Explicit boundary for Phase-C deferred cloud-only surfaces.
 *
 * Covered journeys never import this module. The remaining non-journey LoRA,
 * resources, settings, and TBI surfaces retain their Supabase implementation
 * until a later cutover/retirement phase. Keeping the SDK dependency behind
 * this named `defer` boundary prevents it leaking back into bridge-client
 * modules without pretending those deferred features have Astrid routes.
 */
import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/databasePublicTypes';

export type DeferredSupabaseClient = SupabaseClient<Database>;
export type DeferredSession = Session;
export type DeferredUser = User;

export function createDeferredSupabaseClient(
  url: string,
  key: string,
  options: Parameters<typeof createClient<Database>>[2],
): DeferredSupabaseClient {
  return createClient<Database>(url, key, options);
}
