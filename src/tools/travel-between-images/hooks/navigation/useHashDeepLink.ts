import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { Shot } from '@/domains/generation/types';
import { assertDeferredCloudShotOperation } from '@/shared/hooks/shots/shotAuthority';

interface UseHashDeepLinkOptions {
  /** Current shot ID from context */
  currentShotId: string | null;
  /** Set the current shot ID */
  setCurrentShotId: (id: string | null) => void;
  /** Selected project ID */
  selectedProjectId: string | null;
  /** Set the selected project ID */
  setSelectedProjectId: (id: string) => void;
  /** Array of shots (from query) */
  shots: Shot[] | undefined;
  /** Whether shots are still loading */
  shotsLoading: boolean;
  /** Shot data from navigation state (for newly created shots) */
  shotFromState: Shot | undefined;
  /** Whether this is a newly created shot (from navigation state) */
  isNewlyCreatedShot: boolean;
}

interface UseHashDeepLinkResult {
  /** The shot ID extracted from the URL hash (validated UUID) */
  hashShotId: string;
  /** Whether we're in a grace period after hash change (waiting for data) */
  hashLoadingGrace: boolean;
  /** Whether we're still initializing from a deep link */
  initializingFromHash: boolean;
}

/**
 * Handles deep linking via URL hash.
 *
 * Responsibilities:
 * - Extracting and validating shot ID from URL hash
 * - Grace period when navigating to a new hash (waiting for data)
 * - Resolving project ID when deep-linking directly to a shot URL
 * - Setting currentShotId from hash on initial load
 * - Redirecting when shot doesn't exist
 *
 * Note: URL sync (keeping hash in sync with selection) is handled by useUrlSync.
 */
export function useHashDeepLink({
  currentShotId,
  setCurrentShotId,
  selectedProjectId,
  setSelectedProjectId,
  shots,
  shotsLoading,
  shotFromState,
  isNewlyCreatedShot,
}: UseHashDeepLinkOptions): UseHashDeepLinkResult {
  const location = useLocation();
  const navigate = useNavigate();

  // Grace period state
  const lastHashRef = useRef<string>('');
  const hashChangeTimeRef = useRef<number>(0);
  const [hashLoadingGrace, setHashLoadingGrace] = useState(false);

  // Deep-link initialization state
  const [initializingFromHash, setInitializingFromHash] = useState(false);
  const initializingFromHashRef = useRef(false);

  // Extract and validate hash shot ID
  const hashShotId = useMemo(() => {
    const fromLocation = location.hash?.replace('#', '') || '';
    if (fromLocation) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(fromLocation)) {
        return fromLocation;
      }
    }
    // Fallback to window.location for SSR/hydration edge cases
    if (typeof window !== 'undefined' && window.location?.hash) {
      const windowHash = window.location.hash.replace('#', '');
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(windowHash)) {
        return windowHash;
      }
    }
    return '';
  }, [location.hash]);

  // Set grace period when hash changes
  useEffect(() => {
    if (hashShotId && hashShotId !== lastHashRef.current) {
      lastHashRef.current = hashShotId;
      hashChangeTimeRef.current = Date.now();
      setHashLoadingGrace(true);
    }
  }, [hashShotId]);

  // Clear grace period when we have definitive information
  useEffect(() => {
    if (!hashLoadingGrace) return;

    // Shot found in cache
    if (shots?.find(shot => shot.id === hashShotId)) {
      setHashLoadingGrace(false);
      return;
    }

    // Newly created shot with matching state
    if (isNewlyCreatedShot && shotFromState?.id === hashShotId) {
      setHashLoadingGrace(false);
      return;
    }

    // Shots loaded, not newly created, shot not found after timeout
    const timeSinceHashChange = Date.now() - hashChangeTimeRef.current;
    if (shots && !shotsLoading && !isNewlyCreatedShot && timeSinceHashChange > 5000) {
      setHashLoadingGrace(false);
    }
  }, [hashLoadingGrace, shots, shotsLoading, hashShotId, isNewlyCreatedShot, shotFromState]);

  // Track initialization state for deep links
  useEffect(() => {
    if (hashShotId) {
      const stillInitializing = !selectedProjectId || shotsLoading || !shots;
      if (initializingFromHashRef.current !== stillInitializing) {
        initializingFromHashRef.current = stillInitializing;
        setInitializingFromHash(stillInitializing);
      }
    } else if (initializingFromHashRef.current) {
      initializingFromHashRef.current = false;
      setInitializingFromHash(false);
    }
  }, [hashShotId, selectedProjectId, shotsLoading, shots]);

  // Set currentShotId from hash and resolve project if needed
  useEffect(() => {
    if (!hashShotId) return;

    // Set current shot ID immediately if not already set
    if (!currentShotId) {
      setCurrentShotId(hashShotId);
    }

    // If we already have a project selected, we're done
    if (selectedProjectId) return;

    // Resolve project from shot when deep-linking
    let cancelled = false;
    (async () => {
      try {
        assertDeferredCloudShotOperation('resolve a shot deep link');
        const { data, error } = await supabase().from('shots')
          .select('project_id')
          .eq('id', hashShotId)
          .single();

        if (error) {
          normalizeAndPresentError(error, { context: 'useHashDeepLink', showToast: false });
          if (!cancelled) {
            navigate('/tools/travel-between-images', { replace: true });
          }
          return;
        }

        if (!cancelled && data?.project_id) {
          setSelectedProjectId(data.project_id);
        }
      } catch (err) {
        normalizeAndPresentError(err, { context: 'useHashDeepLink', showToast: false });
        if (!cancelled) {
          navigate('/tools/travel-between-images', { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [hashShotId, currentShotId, selectedProjectId, setSelectedProjectId, navigate, setCurrentShotId]);

  // Redirect if hash shot doesn't exist after shots have loaded
  useEffect(() => {
    const shotFromStateValid = shotFromState && shotFromState.id === hashShotId;

    if (hashShotId && shots && !shots.find(shot => shot.id === hashShotId) && !shotFromStateValid && !isNewlyCreatedShot && !hashLoadingGrace) {
      navigate('/tools/travel-between-images', { replace: true });
    }
  }, [hashShotId, shots, navigate, shotFromState, isNewlyCreatedShot, hashLoadingGrace]);

  return {
    hashShotId,
    hashLoadingGrace,
    initializingFromHash,
  };
}
