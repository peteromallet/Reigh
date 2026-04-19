import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Clapperboard, RefreshCw, Scissors, Trash2, Video } from 'lucide-react';

const VIEWPORT_MARGIN = 8;

export type ShotGroupMenuState = {
  x: number;
  y: number;
  shotId: string;
  shotName: string;
  clipIds: string[];
  rowId: string;
  trackId: string;
  hasFinalVideo: boolean;
  hasStaleVideo: boolean;
  mode?: 'images' | 'video';
} | null;

interface ShotGroupContextMenuProps {
  menu: ShotGroupMenuState;
  menuRef: React.RefObject<HTMLDivElement>;
  closeMenu: () => void;
  onNavigate?: (shotId: string) => void;
  onGenerateVideo?: (shotId: string) => void;
  onSwitchToFinalVideo?: (group: { shotId: string; clipIds: string[]; rowId: string }) => void;
  onSwitchToImages?: (group: { shotId: string; rowId: string }) => void;
  onUpdateToLatestVideo?: (group: { shotId: string; rowId: string }) => void;
  onUnpinGroup?: (group: { shotId: string; trackId: string }) => void;
  onDeleteShot?: (group: { shotId: string; trackId: string; clipIds: string[] }) => void;
}

export function ShotGroupContextMenu({
  menu,
  menuRef,
  closeMenu,
  onNavigate,
  onGenerateVideo,
  onSwitchToFinalVideo,
  onSwitchToImages,
  onUpdateToLatestVideo,
  onUnpinGroup,
  onDeleteShot,
}: ShotGroupContextMenuProps) {
  const [adjustedPosition, setAdjustedPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu) {
      setAdjustedPosition(null);
      return;
    }
    const node = menuRef.current;
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width + VIEWPORT_MARGIN > viewportWidth) {
      left = Math.max(VIEWPORT_MARGIN, viewportWidth - rect.width - VIEWPORT_MARGIN);
    }
    if (top + rect.height + VIEWPORT_MARGIN > viewportHeight) {
      // Flip above the click point if there's room, otherwise clamp to viewport.
      const flipped = menu.y - rect.height;
      top = flipped >= VIEWPORT_MARGIN
        ? flipped
        : Math.max(VIEWPORT_MARGIN, viewportHeight - rect.height - VIEWPORT_MARGIN);
    }
    setAdjustedPosition({ left, top });
  }, [menu, menuRef]);

  if (!menu) {
    return null;
  }

  const pinActions = [
    onUnpinGroup
      ? {
          key: 'deconstruct-shot-group',
          label: 'Deconstruct shot',
          icon: Scissors,
          onClick: () => onUnpinGroup({ shotId: menu.shotId, trackId: menu.trackId }),
        }
      : null,
    onDeleteShot
      ? {
          key: 'delete-shot-group',
          label: 'Delete shot',
          icon: Trash2,
          onClick: () => onDeleteShot({ shotId: menu.shotId, trackId: menu.trackId, clipIds: menu.clipIds }),
        }
      : null,
  ].filter((action): action is { key: string; label: string; icon: typeof Video; onClick: () => void } => Boolean(action));
  const finalVideoActions = menu.hasFinalVideo && menu.mode !== 'video'
    ? [
      onSwitchToFinalVideo
        ? {
          key: 'switch-final-video',
          label: 'Switch to Final Video',
          icon: Video,
          onClick: () => onSwitchToFinalVideo({ shotId: menu.shotId, clipIds: menu.clipIds, rowId: menu.rowId }),
        }
        : null,
    ].filter((action): action is { key: string; label: string; icon: typeof Video; onClick: () => void } => Boolean(action))
    : [];
  const imageActions = menu.mode === 'video'
    ? [
      onSwitchToImages
        ? {
            key: 'switch-images',
            label: 'Switch to Images',
            icon: Video,
            onClick: () => onSwitchToImages({ shotId: menu.shotId, rowId: menu.rowId }),
          }
        : null,
    ].filter((action): action is { key: string; label: string; icon: typeof Video; onClick: () => void } => Boolean(action))
    : [];
  const staleVideoActions = menu.hasStaleVideo && menu.mode === 'video'
    ? [
      onUpdateToLatestVideo
        ? {
          key: 'update-latest-video',
          label: 'Update to Latest Video',
          icon: RefreshCw,
          onClick: () => onUpdateToLatestVideo({ shotId: menu.shotId, rowId: menu.rowId }),
        }
        : null,
    ].filter((action): action is { key: string; label: string; icon: typeof Video; onClick: () => void } => Boolean(action))
    : [];
  const defaultActions = [
    onNavigate
      ? { key: 'jump-to-shot', label: 'Jump to Shot', icon: ArrowRight, onClick: () => onNavigate(menu.shotId) }
      : null,
    onGenerateVideo
      ? { key: 'generate-video', label: 'Generate Video', icon: Clapperboard, onClick: () => onGenerateVideo(menu.shotId) }
      : null,
  ].filter((action): action is { key: string; label: string; icon: typeof Video; onClick: () => void } => Boolean(action));

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        left: adjustedPosition?.left ?? menu.x,
        top: adjustedPosition?.top ?? menu.y,
        visibility: adjustedPosition ? 'visible' : 'hidden',
      }}
    >
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{menu.shotName}</div>
      {pinActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => { action.onClick(); closeMenu(); }}
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
      {pinActions.length > 0 && (finalVideoActions.length > 0 || imageActions.length > 0 || staleVideoActions.length > 0 || defaultActions.length > 0) && <div className="my-1 h-px bg-border" />}
      {finalVideoActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => { action.onClick(); closeMenu(); }}
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
      {imageActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => { action.onClick(); closeMenu(); }}
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
      {staleVideoActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => { action.onClick(); closeMenu(); }}
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
      {(finalVideoActions.length > 0 || imageActions.length > 0 || staleVideoActions.length > 0) && defaultActions.length > 0 && <div className="my-1 h-px bg-border" />}
      {defaultActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => { action.onClick(); closeMenu(); }}
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
