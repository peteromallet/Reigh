import type { DeferredSupabaseClient } from '@/integrations/supabase/deferredRuntime';
import { initAuthStateManager } from '@/integrations/supabase/auth/AuthStateManager';
import { initializeReconnectScheduler } from '@/integrations/supabase/support/reconnect/ReconnectScheduler';
import { maybeAutoLogin } from '@/integrations/supabase/support/dev/autoLogin';
import { initializeToolSettingsAuthCache } from '@/shared/settings';

export function initializeSupabaseRuntime(
  client: DeferredSupabaseClient,
): void {
  // Shared runtime wiring after client construction.
  const reconnectScheduler = initializeReconnectScheduler();
  const authStateManager = initAuthStateManager(client, reconnectScheduler);
  initializeToolSettingsAuthCache(client, authStateManager);
  maybeAutoLogin(client);
}
