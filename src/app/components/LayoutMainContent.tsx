import type { CSSProperties } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { GlobalHeader } from '@/shared/components/GlobalHeader';
import { GlobalProcessingWarning } from '@/shared/components/ProcessingWarnings';
import { useHeaderState } from '@/shared/contexts/ToolPageHeaderContext';
import { useViewportResponsive } from '@/shared/hooks/responsive/useViewportResponsive';
import { cn } from '@/shared/components/ui/contracts/cn';
import { useVideoEditorRouteState } from '@/app/hooks/useVideoEditorRouteState';
import { usePanesStore } from '@/shared/state/panesStore';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority.ts';
import { TOOL_ROUTES } from '@/shared/lib/tooling/toolRoutes';

interface LayoutMainContentProps {
  isMobileSplitView: boolean;
  onOpenSettings: (initialTab?: string, creditsTab?: 'purchase' | 'history') => void;
}

/**
 * The processing warning belongs to the deferred legacy cloud shell.  Astrid
 * authority has no credits/account-settings surface, and mounting the warning
 * would execute its Supabase-backed hooks even when the user is in the local
 * application. Keep this decision at the layout boundary so the legacy
 * component is not mounted (and its hooks cannot issue requests) at all.
 */
function shouldRenderGlobalProcessingWarning(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): boolean {
  return isDeferredCloudDataAuthority(search);
}

export function LayoutMainContent(props: LayoutMainContentProps) {
  const { isMobileSplitView, onOpenSettings } = props;
  const { pathname } = useLocation();
  const { isEditorRoute, isVideoEditorShellActive } = useVideoEditorRouteState();
  const isEditorPaneLocked = usePanesStore((state) => state.isEditorPaneLocked);
  const effectiveEditorPaneHeight = usePanesStore((state) => state.effectiveEditorPaneHeight);
  const isTasksPaneLocked = usePanesStore((state) => state.isTasksPaneLocked);
  const tasksPaneWidth = usePanesStore((state) => state.tasksPaneWidth);
  const isShotsPaneLocked = usePanesStore((state) => state.isShotsPaneLocked);
  const shotsPaneWidth = usePanesStore((state) => state.shotsPaneWidth);
  const isGenerationsPaneLocked = usePanesStore((state) => state.isGenerationsPaneLocked);
  const isGenerationsPaneOpen = usePanesStore((state) => state.isGenerationsPaneOpen);
  const effectiveGenerationsPaneHeight = usePanesStore((state) => state.effectiveGenerationsPaneHeight);
  const { header } = useHeaderState();
  const { isSm, isMd, isLg, isXl, is2Xl, contentWidth, contentHeight } = useViewportResponsive();

  const containerPadding = isLg ? 'px-6' : isSm ? 'px-4' : 'px-2';
  const containerSpacing = 'py-1';
  const isImageGenerationPage = pathname === TOOL_ROUTES.IMAGE_GENERATION;

  const contentStyle = {
    marginRight: isTasksPaneLocked ? `${tasksPaneWidth}px` : '0px',
    marginLeft: isShotsPaneLocked ? `${shotsPaneWidth}px` : '0px',
    paddingTop: isEditorPaneLocked && isVideoEditorShellActive ? `${effectiveEditorPaneHeight}px` : '0px',
    paddingBottom: isMobileSplitView || isImageGenerationPage
      ? '0px'
      : ((isGenerationsPaneLocked || isGenerationsPaneOpen) ? `${effectiveGenerationsPaneHeight}px` : '0px'),
    '--content-width': `${contentWidth}px`,
    '--content-height': `${contentHeight}px`,
    '--content-sm': isSm ? '1' : '0',
    '--content-md': isMd ? '1' : '0',
    '--content-lg': isLg ? '1' : '0',
    '--content-xl': isXl ? '1' : '0',
    '--content-2xl': is2Xl ? '1' : '0',
    willChange: 'margin, padding',
  } as CSSProperties;

  return (
    <>
      {!isVideoEditorShellActive && (
        <GlobalHeader
          contentOffsetRight={isTasksPaneLocked ? tasksPaneWidth + 16 : 16}
          contentOffsetLeft={isShotsPaneLocked ? shotsPaneWidth : 0}
          onOpenSettings={onOpenSettings}
        />
      )}

      <div
        className={cn(
          'relative z-10 content-container',
          isVideoEditorShellActive
            ? 'h-screen overflow-hidden transition-[margin,padding] duration-300 ease-smooth'
            : 'transition-[margin,padding] duration-300 ease-smooth',
        )}
        data-video-editor-route={isEditorRoute ? 'true' : 'false'}
        data-video-editor-shell-active={isVideoEditorShellActive ? 'true' : 'false'}
        style={contentStyle}
      >
        {!isVideoEditorShellActive && shouldRenderGlobalProcessingWarning() && (
          <GlobalProcessingWarning onOpenSettings={onOpenSettings} />
        )}

        <main
          className={cn(
            isVideoEditorShellActive
              ? 'h-full w-full overflow-hidden'
              : cn('container mx-auto', containerPadding, containerSpacing),
          )}
        >
          {!isVideoEditorShellActive && header}
          <Outlet />
        </main>
      </div>
    </>
  );
}
