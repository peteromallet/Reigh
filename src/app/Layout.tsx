import React, { useEffect } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { TasksPane } from '@/features/tasks/components/TasksPane/TasksPane';
import { GenerationsPane } from '@/features/gallery/components/GenerationsPane/GenerationsPane';
import { EditorPane } from '@/features/editor/components/EditorPaneTab';
import { ToolsPane } from '@/shared/components/ToolsPane/ToolsPane';
import { ReighLoading } from '@/shared/components/ReighLoading';
import { SettingsModal } from '@/shared/components/SettingsModal/SettingsModal';
import { OnboardingModal } from '@/shared/components/modals/OnboardingModal';
import { ChunkLoadErrorBoundary } from '@/shared/runtime/ChunkLoadErrorBoundary';
import { dispatchAppEvent } from '@/shared/lib/typedEvents';

// Lazy load ProductTour since it only shows during onboarding
const LazyProductTour = React.lazy(() =>
  import('@/shared/components/ProductTour').then(module => ({
    default: module.ProductTour
  }))
);
import { AIInputModeProvider } from '@/shared/contexts/AIInputModeContext';
import { useIsMobile, useIsTablet } from '@/shared/hooks/mobile';
import { cn } from '@/shared/components/ui/contracts/cn';
import { isVideoEditorRoute, useVideoEditorRouteState } from '@/app/hooks/useVideoEditorRouteState';
import { SocialIcons } from './components/SocialIcons';

import { useAuth } from '@/shared/contexts/AuthContext';
import { useSplitViewScroll } from './hooks/useSplitViewScroll';
import { useGlobalPaneShortcuts } from './hooks/useGlobalPaneShortcuts';
import { useSettingsModal } from './hooks/useSettingsModal';
import { useOnboardingFlow } from './hooks/useOnboardingFlow';
import { useResetCurrentShotOnRouteChange } from './hooks/useResetCurrentShotOnRouteChange';
import { LayoutMainContent } from './components/LayoutMainContent';
import { usePanesStore } from '@/shared/state/panesStore';
import { isLocalTestMode } from '@/app/localTestRuntime';

// Scroll to top component
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    // Also dispatch event for custom scroll containers
    dispatchAppEvent('app:scrollToTop', { behavior: 'auto' });
  }, [pathname]);

  return null;
}

export const Layout: React.FC = () => {
  const { pathname, search } = useLocation();
  // The deterministic browser editor is intentionally sessionless.  It still
  // uses the normal Layout so the production shell and extension host are
  // exercised, but it must not be redirected to Home (which mounts the legacy
  // Supabase auth subscription).  AuthProvider already short-circuits this
  // mode; keep the route-access decision on the same explicit DEV/query
  // contract rather than inventing a fake authenticated user.
  const localParams = new URLSearchParams(search);
  const localProject = localParams.get('localProject')?.trim();
  const localTimeline = localParams.get('localTimeline')?.trim();
  const isLocalEditorTest = isVideoEditorRoute(pathname)
    && isLocalTestMode(import.meta.env, search)
    && Boolean(localProject)
    && Boolean(localTimeline);
  const { isVideoEditorShellActive } = useVideoEditorRouteState();
  const isTasksPaneLocked = usePanesStore((state) => state.isTasksPaneLocked);
  const tasksPaneWidth = usePanesStore((state) => state.tasksPaneWidth);
  const isShotsPaneLocked = usePanesStore((state) => state.isShotsPaneLocked);
  const shotsPaneWidth = usePanesStore((state) => state.shotsPaneWidth);
  const isGenerationsPaneLocked = usePanesStore((state) => state.isGenerationsPaneLocked);
  const generationsPaneHeight = usePanesStore((state) => state.generationsPaneHeight);

  // Mobile detection for split-view scroll handling
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const isSmallMobile = isMobile && !isTablet;

  // On small mobile with locked generations pane, create split-view scroll behavior
  const isMobileSplitView = isSmallMobile && isGenerationsPaneLocked && !isVideoEditorShellActive;

  // Extracted hooks
  const { splitViewWrapperRef } = useSplitViewScroll(isMobileSplitView);
  const { isAuthenticated, isLoading } = useAuth();
  const { isSettingsModalOpen, setIsSettingsModalOpen, settingsInitialTab, settingsCreditsTab, handleOpenSettings } = useSettingsModal();
  const { showOnboardingModal, handleOnboardingClose } = useOnboardingFlow();
  useResetCurrentShotOnRouteChange();
  useGlobalPaneShortcuts();

  // Show loading spinner while determining auth state
  // (isLoading is always false here because AuthGate gates on it, but kept for safety)
  if (isLoading) {
    return (
      <ReighLoading />
    );
  }

  // Redirect unauthenticated users to home page
  // Use /home instead of / to avoid redirect loops in non-WEB environments
  // where / is inside Layout.
  //
  // Auth is decided by the bridge probe alone (`useAuth`): a healthy
  // `/api/astrid` resolves the fixed local user, so this gate passes on the
  // probe and never depends on URL params or stored credentials. When the
  // probe fails the user is sent to the public home page — one hop, no loop:
  // `/` outside Layout does not re-enter this gate (and in WEB env `/` is
  // `HomeWithAuthRedirect`, which renders HomePage directly).
  if (!isAuthenticated && !isLocalEditorTest) {
    return <Navigate to="/home" replace state={{ fromProtected: true }} />;
  }

  // Footer style matches main content margins for side panes
  const footerStyle = {
    marginRight: isTasksPaneLocked ? `${tasksPaneWidth}px` : '0px',
    marginLeft: isShotsPaneLocked ? `${shotsPaneWidth}px` : '0px',
    willChange: 'margin',
  } as React.CSSProperties;

  // Style for the scroll wrapper when in mobile split view
  // This wraps both header and content so they scroll together
  const splitViewWrapperStyle: React.CSSProperties = isMobileSplitView ? {
    height: `calc(100dvh - ${generationsPaneHeight}px)`,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch',
  } : {};

  const mainContent = (
    <LayoutMainContent
      isMobileSplitView={isMobileSplitView}
      onOpenSettings={handleOpenSettings}
    />
  );

  return (
    <AIInputModeProvider>
      <div className={cn('flex flex-col', isVideoEditorShellActive && 'h-screen overflow-hidden')}>
        <ScrollToTop />
        {/* Theme-adaptive background gradient - subtle in dark mode */}
        <div className="fixed inset-0 bg-gradient-to-br from-background via-secondary/10 to-accent/5 opacity-40 dark:opacity-0 pointer-events-none"></div>

        {/* When in mobile split view, wrap header + content in a scroll container */}
        {isMobileSplitView ? (
          <div ref={splitViewWrapperRef} style={splitViewWrapperStyle}>
            {mainContent}
          </div>
        ) : (
          mainContent
        )}

        {/* App-shell panes. Local mode renders them too: every pane already
            no-ops on a missing userId (queries gated on project/user), so the
            sessionless shell shows the same chrome as app mode. */}
        <>
          <EditorPane />
          <TasksPane onOpenSettings={handleOpenSettings} />
          <ToolsPane />
          <GenerationsPane />
        </>

        {/* Social Icons Footer */}
        {!isVideoEditorShellActive && (
          <div
            className="relative transition-[margin] duration-300 ease-smooth"
            style={footerStyle}
          >
            <SocialIcons />
          </div>
        )}

        {/* App-shell modals. Local mode renders them too; their content
            degrades to empty/disabled states without account data. */}
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onOpenChange={setIsSettingsModalOpen}
          initialTab={settingsInitialTab}
          creditsTab={settingsCreditsTab}
        />

        {/* Onboarding Modal */}
        <OnboardingModal
          isOpen={showOnboardingModal}
          onClose={handleOnboardingClose}
        />

        {/* Product Tour - lazy loaded since only needed during onboarding */}
        <ChunkLoadErrorBoundary>
          <React.Suspense fallback={null}>
            <LazyProductTour />
          </React.Suspense>
        </ChunkLoadErrorBoundary>
      </div>
    </AIInputModeProvider>
  );
};
