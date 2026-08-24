import { describe, expect, it, vi } from 'vitest';
import type { DeferredSession, DeferredSupabaseClient } from '@/integrations/supabase/deferredRuntime';
import {
  requireSession,
  requireUserFromSession,
} from '../ensureAuthenticatedSession';

function createClient(sessionResult: {
  data: { session: DeferredSession | null };
  error: { message: string } | null;
}): DeferredSupabaseClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue(sessionResult),
    },
  } as unknown as DeferredSupabaseClient;
}

describe('ensureAuthenticatedSession', () => {
  it('returns session when authenticated', async () => {
    const session = {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token',
      user: { id: 'user-1' },
    } as unknown as DeferredSession;
    const client = createClient({ data: { session }, error: null });

    await expect(requireSession(client, 'test-auth')).resolves.toBe(session);
  });

  it('throws contextual error when session lookup fails', async () => {
    const client = createClient({
      data: { session: null },
      error: { message: 'boom' },
    });

    await expect(requireSession(client, 'test-auth')).rejects.toThrow(
      'test-auth: Failed to get session',
    );
  });

  it('throws when user is missing from authenticated session', async () => {
    const sessionWithoutUser = {
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token',
      user: null,
    } as unknown as DeferredSession;
    const client = createClient({ data: { session: sessionWithoutUser }, error: null });

    await expect(requireUserFromSession(client, 'test-auth')).rejects.toThrow(
      'test-auth: Authenticated session has no user',
    );
  });
});
