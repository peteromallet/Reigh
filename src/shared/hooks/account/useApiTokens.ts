import { getSupabaseClient } from '@/integrations/supabase/client';
import { invokeSupabaseEdgeFunction } from '@/integrations/supabase/functions/invokeSupabaseEdgeFunction';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiQueryKeys } from '@/shared/lib/queryKeys/api';
import { normalizeAndPresentAndRethrow } from '@/shared/lib/errorHandling/runtimeError';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import {
  requireSession,
  requireUserFromSession,
} from '@/integrations/supabase/auth/ensureAuthenticatedSession';
import { isLocalTestMode } from '@/app/localTestRuntime';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';

interface ApiToken {
  id: string;
  user_id: string;
  token: string;
  label: string | null;
  created_at: string;
}

interface GenerateTokenResponse {
  token: string;
}

// Fetch user's API tokens
const fetchApiTokens = async (): Promise<ApiToken[]> => {
  try {
    const supabase = getSupabaseClient();
    const user = await requireUserFromSession(supabase, 'useApiTokens.fetchApiTokens');

    const { data, error } = await supabase
      .from('user_api_tokens')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    normalizeAndPresentAndRethrow(error, {
      context: 'useApiTokens.fetchApiTokens',
      showToast: false,
    });
  }
};

// Generate a new API token
const generateApiToken = async (params: { label: string }): Promise<GenerateTokenResponse> => {
  try {
    const supabase = getSupabaseClient();
    await requireSession(supabase, 'useApiTokens.generateApiToken');

    return await invokeSupabaseEdgeFunction<GenerateTokenResponse>('generate-pat', {
      body: params,
      timeoutMs: 20000,
    });
  } catch (error) {
    normalizeAndPresentAndRethrow(error, {
      context: 'useApiTokens.generateApiToken',
      showToast: false,
    });
  }
};

// Revoke an API token
const revokeApiToken = async (tokenId: string): Promise<void> => {
  try {
    const supabase = getSupabaseClient();
    await requireSession(supabase, 'useApiTokens.revokeApiToken');

    await invokeSupabaseEdgeFunction('revoke-pat', {
      body: { tokenId },
      timeoutMs: 20000,
    });
  } catch (error) {
    normalizeAndPresentAndRethrow(error, {
      context: 'useApiTokens.revokeApiToken',
      showToast: false,
    });
  }
};

export const useApiTokens = () => {
  const queryClient = useQueryClient();
  const isLocalMode = hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const localTestMode = isLocalTestMode();
  
  // Query to fetch API tokens
  const {
    data: tokens,
    isLoading,
    error
  } = useQuery({
    queryKey: apiQueryKeys.tokens,
    queryFn: fetchApiTokens,
    // API tokens are account credentials, not Astrid document data. The local
    // editor must not even attempt the auth probe that precedes this query.
    enabled: !localTestMode && !isLocalMode,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Mutation to generate a new API token
  const generateMutation = useMutation({
    mutationFn: (params: { label: string }) => {
      if (isLocalMode) {
        throw new Error('API tokens are unavailable in local editor mode');
      }
      return generateApiToken(params);
    },
    onMutate: () => {
      setIsGenerating(true);
    },
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      queryClient.invalidateQueries({ queryKey: apiQueryKeys.tokens });      
    },
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useApiTokens', toastTitle: 'Failed to generate API token' });
    },
    onSettled: () => {
      setIsGenerating(false);
    }
  });

  // Mutation to revoke an API token
  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => {
      if (isLocalMode) {
        throw new Error('API tokens are unavailable in local editor mode');
      }
      return revokeApiToken(tokenId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiQueryKeys.tokens });
      
    },
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useApiTokens', toastTitle: 'Failed to revoke API token' });
    },
  });

  const refreshTokenMutation = useMutation({
    mutationFn: async (tokenToRefresh: ApiToken) => {
      if (isLocalMode) {
        throw new Error('API tokens are unavailable in local editor mode');
      }
      await revokeApiToken(tokenToRefresh.id);
      return generateApiToken({
        label: tokenToRefresh.label || "Local Generator",
      });
    },
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      queryClient.invalidateQueries({ queryKey: apiQueryKeys.tokens });
      
    },
    onError: (error: Error) => {
      normalizeAndPresentError(error, { context: 'useApiTokens', toastTitle: 'Failed to refresh token' });
    },
  });

  const generateToken = (label: string) => {
    if (localTestMode) return;
    generateMutation.mutate({ label });
  };

  const revokeToken = (tokenId: string) => {
    if (localTestMode) return;
    revokeMutation.mutate(tokenId);
  };

  const refreshToken = (token: ApiToken) => {
    if (localTestMode) return;
    refreshTokenMutation.mutate(token);
  };

  const clearGeneratedToken = () => {
    setGeneratedToken(null);
  };

  return {
    tokens: tokens || [],
    isLoading,
    error,
    generateToken,
    revokeToken,
    refreshToken,
    isGenerating,
    generatedToken,
    clearGeneratedToken,
    isRevoking: revokeMutation.isPending,
    isRefreshing: refreshTokenMutation.isPending,
  };
}; 
