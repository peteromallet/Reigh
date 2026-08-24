import { getSupabaseClient } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@/integrations/supabase/jsonTypes';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { isNotFoundError } from '@/shared/constants/supabaseErrors';
import { apiQueryKeys } from '@/shared/lib/queryKeys/api';
import { requireUserFromSession } from '@/integrations/supabase/auth/ensureAuthenticatedSession';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';

interface ApiKeys {
  fal_api_key?: string;
  openai_api_key?: string;
  replicate_api_key?: string;
  [key: string]: Json | undefined;
}

// Fetch API keys from the database
const fetchApiKeys = async (): Promise<ApiKeys> => {
  const supabase = getSupabaseClient();
  const user = await requireUserFromSession(supabase, 'useApiKeys.fetchApiKeys');
  
  const { data, error } = await supabase
    .from('users')
    .select('api_keys')
    .eq('id', user.id)
    .single();
  
  if (error) {
    // User might not exist yet, return empty keys
    if (isNotFoundError(error)) {
      return {};
    }
    throw error;
  }
  
  return (data?.api_keys as ApiKeys) || {};
};

// Update API keys in the database using upsert (atomic insert-or-update)
const updateApiKeys = async (apiKeys: ApiKeys): Promise<ApiKeys> => {
  const supabase = getSupabaseClient();
  const user = await requireUserFromSession(supabase, 'useApiKeys.updateApiKeys');

  const { data, error } = await supabase
    .from('users')
    .upsert({ id: user.id, api_keys: apiKeys }, { onConflict: 'id' })
    .select('api_keys')
    .single();

  if (error) throw error;
  return (data?.api_keys as ApiKeys) || {};
};

export const useApiKeys = () => {
  const queryClient = useQueryClient();
  const isLocalMode = hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  
  // Query to fetch API keys
  const {
    data: apiKeys,
    isLoading,
    error
  } = useQuery({
    queryKey: apiQueryKeys.keys,
    queryFn: fetchApiKeys,
    enabled: !isLocalMode,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Mutation to update API keys
  const updateMutation = useMutation({
    mutationFn: (apiKeys: ApiKeys) => {
      if (isLocalMode) {
        throw new Error('API keys are unavailable in local editor mode');
      }
      return updateApiKeys(apiKeys);
    },
    onSuccess: (updatedKeys) => {
      queryClient.setQueryData(apiQueryKeys.keys, updatedKeys);

    },
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useApiKeys', toastTitle: 'Failed to update API keys' });
    },
  });

  const saveApiKeys = (newApiKeys: ApiKeys) => {
    updateMutation.mutate(newApiKeys);
  };

  // Helper function to get a specific API key
  const getApiKey = (keyName: keyof ApiKeys): string => {
    const value = apiKeys?.[keyName];
    return typeof value === 'string' ? value : '';
  };

  return {
    apiKeys: apiKeys || {},
    isLoading,
    error,
    saveApiKeys,
    getApiKey,
    isUpdating: updateMutation.isPending,
  };
}; 
