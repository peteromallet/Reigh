import type {
  DeferredSession,
  DeferredSupabaseClient,
  DeferredUser,
} from '@/integrations/supabase/deferredRuntime';

function buildAuthError(message: string, context: string, cause?: unknown): Error {
  const error = new Error(`${context}: ${message}`);
  if (cause !== undefined) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: true,
    });
  }
  return error;
}

export async function requireSession(
  client: DeferredSupabaseClient,
  context = 'auth',
): Promise<DeferredSession> {
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw buildAuthError('Failed to get session', context, error);
  }
  if (!data.session) {
    throw buildAuthError('Not authenticated', context);
  }
  return data.session;
}

export async function requireUserFromSession(
  client: DeferredSupabaseClient,
  context = 'auth',
): Promise<DeferredUser> {
  const session = await requireSession(client, context);
  if (!session.user) {
    throw buildAuthError('Authenticated session has no user', context);
  }
  return session.user;
}
