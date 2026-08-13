import { memo, useCallback, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHomeNavigation } from '@/shared/hooks/useHomeNavigation.ts';
import { usePanesStore } from '@/shared/state/panesStore.ts';
import { CompactPreview } from '@/tools/video-editor/components/CompactPreview.tsx';
import { TimelineEditorShellCore } from '@/tools/video-editor/components/TimelineEditorShellCore.tsx';

interface ReighVideoEditorShellProps {
  mode: 'full' | 'compact';
  timelineId?: string | null;
  onCreateTimeline?: () => void;
  /** Host controls rendered beside the Back button (e.g. project/timeline selectors). */
  navigationControls?: ReactNode;
}

function ReighVideoEditorShellComponent({ mode, timelineId, onCreateTimeline, navigationControls }: ReighVideoEditorShellProps) {
  const { navigateHome } = useHomeNavigation();
  const isEditorPaneLocked = usePanesStore((state) => state.isEditorPaneLocked);
  const isGenerationsPaneLocked = usePanesStore((state) => state.isGenerationsPaneLocked);
  const setIsGenerationsPaneLocked = usePanesStore((state) => state.setIsGenerationsPaneLocked);
  const location = useLocation();
  const navigate = useNavigate();
  const isOnEditorPage = location.pathname.startsWith('/tools/video-editor');
  const openEditorRoute = useCallback((nextTimelineId: string) => {
    navigate(`/tools/video-editor?timeline=${nextTimelineId}`);
  }, [navigate]);

  if (!timelineId) {
    if (mode === 'compact') {
      return <CompactPreview timelineId={timelineId} onCreateTimeline={onCreateTimeline} />;
    }
    return null;
  }

  return (
    <TimelineEditorShellCore
      timelineId={timelineId}
      forceCondensed={mode === 'compact'}
      isOnEditorPage={isOnEditorPage}
      isEditorPaneLocked={isEditorPaneLocked}
      isGenerationsPaneLocked={isGenerationsPaneLocked}
      onSetGenerationsPaneLocked={setIsGenerationsPaneLocked}
      onNavigateHome={navigateHome}
      onOpenEditorRoute={openEditorRoute}
      navigationControls={navigationControls}
    />
  );
}

export const ReighVideoEditorShell = memo(ReighVideoEditorShellComponent);
