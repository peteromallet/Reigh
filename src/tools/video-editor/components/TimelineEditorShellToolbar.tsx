import type { Dispatch, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { GripHorizontal, History, Maximize2, Minimize2, Redo2, RefreshCw, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge.tsx';
import { Button } from '@/shared/components/ui/button.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu.tsx';
import { useTimelineChromeContext } from '@/tools/video-editor/hooks/timelineStore.ts';
import type { useEditorSync } from '@/tools/video-editor/hooks/useEditorSync.ts';
import { clampTimelineScaleWidth, TIMELINE_ZOOM_STEP } from '@/tools/video-editor/lib/timeline-scale.ts';

const STATUS_VARIANT = {
  saved: 'default',
  saving: 'secondary',
  dirty: 'outline',
  error: 'destructive',
} as const;
const CHECKPOINT_TRIGGER_LABELS = {
  session_boundary: 'Session boundary',
  edit_distance: 'Edit cap',
  semantic: 'Destructive edit',
  manual: 'Manual',
} as const;
const CHECKPOINT_TRIGGER_BADGE_VARIANT = {
  session_boundary: 'secondary',
  edit_distance: 'outline',
  semantic: 'destructive',
  manual: 'default',
} as const;

/**
 * The shell's chrome row: save status, sync, undo/redo/history, the drag
 * handle for the preview/timeline split, and the zoom controls. Shared by all
 * three layout variants.
 */
export function TimelineEditorShellToolbar({
  sync,
  syncResultMessage,
  touchChrome,
  condensed,
  forceCondensed,
  onNavigateHome,
  toolbarModeSwitcher,
  onDividerMouseDown,
  isTimelineMaximized,
  setIsTimelineMaximized,
}: {
  sync: ReturnType<typeof useEditorSync>;
  syncResultMessage: string | null;
  touchChrome: boolean;
  condensed: boolean;
  forceCondensed: boolean;
  onNavigateHome?: () => void;
  toolbarModeSwitcher: ReactNode;
  onDividerMouseDown: (event: ReactMouseEvent) => void;
  isTimelineMaximized: boolean;
  setIsTimelineMaximized: Dispatch<SetStateAction<boolean>>;
}) {
  const chrome = useTimelineChromeContext();
  const toolbarButtonSizeClass = touchChrome ? 'h-11 w-11' : 'h-6 w-6';

  const saveBadge = (
    <Badge variant={STATUS_VARIANT[chrome.saveStatus]} className="h-5 px-1.5 text-[10px] capitalize">
      {chrome.saveStatus}
    </Badge>
  );
  const syncButton = sync.isSyncAvailable ? (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          toolbarButtonSizeClass,
          sync.syncState === 'syncing' && 'animate-spin',
          sync.syncState === 'source_only_saved' && 'text-green-400',
          sync.syncState === 'both_advanced' && 'text-amber-400',
          sync.syncState === 'bookmark_incompatible' && 'text-red-400',
          sync.syncState === 'error' && 'text-red-400',
        )}
        onClick={() => void sync.performSync()}
        disabled={sync.syncState === 'syncing'}
        title="Sync timeline with database"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      {syncResultMessage && sync.syncState !== 'both_advanced' && (
        <span className="max-w-[140px] truncate text-[10px] text-muted-foreground">
          {syncResultMessage}
        </span>
      )}
    </div>
  ) : null;
  // While uploads are in flight the history layer pauses undo/redo (a
  // snapshot restore would strand the upload's registry patch); say so
  // instead of presenting a mysteriously dead button.
  const undoPausedTitle = 'Undo is paused while media uploads finish';
  const redoPausedTitle = 'Redo is paused while media uploads finish';
  const historyControls = (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={toolbarButtonSizeClass}
        onClick={chrome.undo}
        disabled={!chrome.canUndo}
        title={chrome.historyPausedForUploads ? undoPausedTitle : 'Undo'}
        aria-label={chrome.historyPausedForUploads ? undoPausedTitle : 'Undo'}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={toolbarButtonSizeClass}
        onClick={chrome.redo}
        disabled={!chrome.canRedo}
        title={chrome.historyPausedForUploads ? redoPausedTitle : 'Redo'}
        aria-label={chrome.historyPausedForUploads ? redoPausedTitle : 'Redo'}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className={toolbarButtonSizeClass} title="History">
            <History className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel className="pb-1 text-xs font-semibold text-muted-foreground">
            History
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {chrome.checkpoints.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No checkpoints yet. Save one manually or keep editing to build history.
            </div>
          ) : (
            chrome.checkpoints.map((checkpoint) => (
              <DropdownMenuItem
                key={checkpoint.id}
                className="flex flex-col items-start gap-1 py-2"
                onClick={() => chrome.jumpToCheckpoint(checkpoint.id)}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <span className="truncate text-sm text-foreground">{checkpoint.label}</span>
                  <Badge
                    variant={CHECKPOINT_TRIGGER_BADGE_VARIANT[checkpoint.triggerType]}
                    className="shrink-0 px-1.5 py-0 text-[9px] uppercase tracking-[0.12em]"
                  >
                    {CHECKPOINT_TRIGGER_LABELS[checkpoint.triggerType]}
                  </Badge>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(checkpoint.createdAt), { addSuffix: true })}
                </span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void chrome.createManualCheckpoint()}>
            Save checkpoint
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/80 px-2 text-muted-foreground',
        touchChrome ? 'min-h-11 py-1' : 'h-7',
        // The compact mode switcher rides in this row. It fits inline on tablet
        // landscape and wraps to a second line on portrait, which keeps the
        // preview's `1fr` intact where vertical space is tightest.
        toolbarModeSwitcher && 'h-auto flex-wrap',
      )}
    >
      <div className="flex items-center gap-1">
        {condensed && !forceCondensed && onNavigateHome && (
          <button
            type="button"
            className="mr-2 min-h-11 shrink-0 px-2 text-[11px] transition-colors hover:text-foreground motion-reduce:transition-none"
            onClick={onNavigateHome}
          >
            ← Back
          </button>
        )}
        {saveBadge}
        {syncButton}
        {historyControls}
      </div>
      {toolbarModeSwitcher}
      {!condensed && (
        <div
          className="flex h-full flex-1 cursor-row-resize items-center justify-center"
          onMouseDown={onDividerMouseDown}
        >
          <GripHorizontal className="h-4 w-4 text-border" />
        </div>
      )}
      <div className="flex items-center gap-1">
        {!condensed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={toolbarButtonSizeClass}
            onClick={() => setIsTimelineMaximized((value) => !value)}
            title={isTimelineMaximized ? 'Restore preview and timeline split' : 'Maximize timeline'}
          >
            {isTimelineMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarButtonSizeClass}
          title="Zoom out timeline"
          aria-label="Zoom out timeline"
          onClick={() => chrome.setScaleWidth((value) => clampTimelineScaleWidth(value / TIMELINE_ZOOM_STEP))}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={toolbarButtonSizeClass}
          title="Zoom in timeline"
          aria-label="Zoom in timeline"
          onClick={() => chrome.setScaleWidth((value) => clampTimelineScaleWidth(value * TIMELINE_ZOOM_STEP))}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
