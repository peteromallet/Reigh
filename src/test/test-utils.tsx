import React from 'react';
import { renderHook, RenderHookOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Create a fresh QueryClient with retries and caching disabled for tests.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface ProviderOptions {
  queryClient?: QueryClient;
}

/**
 * Creates a wrapper component that provides the QueryClient test context.
 */
function createWrapper(options: ProviderOptions = {}) {
  const queryClient = options.queryClient ?? createTestQueryClient();

  return function TestProviders({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

/**
 * Render a hook wrapped with test providers (QueryClient).
 * Use for hook tests that need React Query context.
 */
export function renderHookWithProviders<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options: ProviderOptions & Omit<RenderHookOptions<TProps>, 'wrapper'> = {},
) {
  const { queryClient, ...hookOptions } = options;
  const Wrapper = createWrapper({ queryClient });
  return renderHook(hook, { wrapper: Wrapper, ...hookOptions });
}

