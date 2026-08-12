import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useProjectSelectionContext } from '@/shared/contexts/ProjectContext';
import { useToolSettings } from '@/shared/hooks/settings/useToolSettings';
import { useUserUIState } from '@/shared/hooks/useUserUIState';
import {
  getCurrentAppEnv,
  isHomeToolPathActive,
  resolveHomeToolPath,
} from '@/shared/lib/tooling/homeNavigation';
import { TOOL_IDS } from '@/shared/lib/tooling/toolIds';
import { usePanesStore } from '@/shared/state/panesStore';
import { videoEditorSettings } from '@/tools/video-editor/settings/videoEditorDefaults';

const FALLBACK_GENERATION_METHODS = { onComputer: true, inCloud: true };

/** True on the backend-free local-mode editor route (`?localProject`/`?localTimeline`). DEV-only: the page itself ignores local params when DEV is off. */
function isLocalModeEditorLocation(pathname: string, search: string): boolean {
  const params = new URLSearchParams(search);
  return (
    import.meta.env.DEV
    && pathname.startsWith('/tools/video-editor')
    && (params.has('localProject') || params.has('localTimeline'))
  );
}

/** Local-mode "home": the timeline picker — keep the project, drop the timeline value. */
function localModeEditorHomeUrl(search: string): string {
  const params = new URLSearchParams(search);
  const next = new URLSearchParams();
  if (params.has('localProject')) {
    next.set('localProject', params.get('localProject') ?? '');
  }
  if (params.has('localTimeline')) {
    next.set('localTimeline', '');
  }
  return `/tools/video-editor${next.size > 0 ? `?${next.toString()}` : ''}`;
}

export function useHomeNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedProjectId } = useProjectSelectionContext();
  const setIsShotsPaneLocked = usePanesStore((state) => state.setIsShotsPaneLocked);
  const { value: defaultTool } = useUserUIState('defaultTool', {
    toolId: TOOL_IDS.TRAVEL_BETWEEN_IMAGES,
  });
  const { value: generationMethods, isLoading: isLoadingGenerationMethods } = useUserUIState(
    'generationMethods',
    FALLBACK_GENERATION_METHODS,
  );
  const { settings: videoEditorProjectSettings } = useToolSettings(videoEditorSettings.id, {
    projectId: selectedProjectId ?? undefined,
    enabled: Boolean(selectedProjectId),
  });

  const targetPath = useMemo(
    () =>
      resolveHomeToolPath({
        preferredToolId: defaultTool.toolId,
        currentEnv: getCurrentAppEnv(),
        isCloudGenerationEnabled: generationMethods.inCloud,
        isLoadingGenerationMethods,
        videoEditorTimelineId: videoEditorProjectSettings?.lastTimelineId,
      }),
    [
      defaultTool.toolId,
      generationMethods.inCloud,
      isLoadingGenerationMethods,
      videoEditorProjectSettings?.lastTimelineId,
    ],
  );

  const navigateHome = useCallback(() => {
    // Inside a video travel shot (deep-linked via hash): back out to the
    // shot list view first instead of the usual home behavior.
    if (
      location.pathname === '/tools/travel-between-images' &&
      location.hash
    ) {
      navigate(location.pathname, { replace: true, state: { fromShotClick: false } });
      return;
    }

    // Local-mode editor (backend-free dev editor, no session): Back returns
    // to the local timeline picker. The home tool path below is session-
    // dependent and renders blank without a session.
    if (isLocalModeEditorLocation(location.pathname, location.search)) {
      navigate(localModeEditorHomeUrl(location.search));
      return;
    }

    if (isHomeToolPathActive(location.pathname, targetPath)) {
      setIsShotsPaneLocked(true);
      return;
    }

    setIsShotsPaneLocked(false);
    navigate(targetPath);
  }, [location.hash, location.pathname, location.search, navigate, setIsShotsPaneLocked, targetPath]);

  return {
    targetPath,
    navigateHome,
  };
}
