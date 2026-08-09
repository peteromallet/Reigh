/**
 * TimelineModeSwitcher — the one rendered control that reaches every touch
 * interaction mode.
 *
 * Two presentations, one component. The phone's stacked layout has a whole row
 * to spend, so it gets the full-width `bar` with a mode hint; the tablet's split
 * layout does not, so it gets the `compact` segmented control that sits in the
 * timeline toolbar row. They are the *same* control: same `setInteractionMode` /
 * `setContextTarget` / `setInspectorTarget` calls, same `aria-pressed` semantics,
 * same 44px touch targets. Keeping them as one component is the point — two
 * copies of "which modes exist and what pressing one does" is exactly the drift
 * that left tablet with no reachable switcher in the first place.
 *
 * Desktop renders nothing: see `resolveTimelineModeSwitcherVariant`.
 */

import { cn } from '@/shared/components/ui/contracts/cn.ts';
import type {
  TimelineInteractionMode,
  TimelineModeSwitcherVariant,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';

export type TimelineSwitchableMode = Exclude<TimelineInteractionMode, 'precision'>;

const MODE_ITEMS: ReadonlyArray<{ mode: TimelineSwitchableMode; label: string }> = [
  { mode: 'browse', label: 'Browse' },
  { mode: 'select', label: 'Select' },
  { mode: 'move', label: 'Move' },
  { mode: 'trim', label: 'Trim' },
];

export const TIMELINE_MODE_HINTS: Record<TimelineInteractionMode, string> = {
  browse: 'Drag to pan the timeline. Tap a mode to start editing.',
  select: 'Tap clips to add or remove them from the selection.',
  move: 'Drag a clip to move it. Drag elsewhere to pan.',
  trim: "Drag a clip's edges to trim it.",
  precision: 'Precision is on: gestures step in finer increments.',
};

/** Shared button chrome. `min-h-11` is the 44px touch target both variants owe. */
const BUTTON_BASE_CLASS =
  'min-h-11 rounded-lg text-[11px] font-medium uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none';
const BUTTON_INACTIVE_CLASS = 'text-muted-foreground hover:bg-muted hover:text-foreground';
const BUTTON_ACTIVE_CLASS = 'bg-accent text-foreground shadow-sm';
const PRECISION_ACTIVE_CLASS = 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-400/50';

export interface TimelineModeSwitcherProps {
  variant: TimelineModeSwitcherVariant;
  interactionMode: TimelineInteractionMode;
  precisionEnabled: boolean;
  onModeChange: (mode: TimelineSwitchableMode) => void;
  onTogglePrecision: () => void;
  /** Extra line appended to the `bar` hint (e.g. where inspector actions live). */
  hintSuffix?: string;
}

export function TimelineModeSwitcher({
  variant,
  interactionMode,
  precisionEnabled,
  onModeChange,
  onTogglePrecision,
  hintSuffix,
}: TimelineModeSwitcherProps) {
  const isBar = variant === 'bar';

  const modeButtons = MODE_ITEMS.map((item) => {
    const isActive = interactionMode === item.mode;
    return (
      <button
        key={item.mode}
        type="button"
        className={cn(
          BUTTON_BASE_CLASS,
          isBar ? 'px-2 py-2' : 'min-w-11 px-2.5',
          isActive ? BUTTON_ACTIVE_CLASS : BUTTON_INACTIVE_CLASS,
        )}
        aria-pressed={isActive}
        onClick={() => onModeChange(item.mode)}
      >
        {item.label}
      </button>
    );
  });

  const precisionButton = (
    <button
      type="button"
      className={cn(
        BUTTON_BASE_CLASS,
        isBar ? 'px-2 py-2' : 'min-w-11 px-2.5',
        precisionEnabled ? PRECISION_ACTIVE_CLASS : BUTTON_INACTIVE_CLASS,
      )}
      aria-pressed={precisionEnabled}
      onClick={onTogglePrecision}
    >
      Precision
    </button>
  );

  if (!isBar) {
    return (
      <div
        className="flex shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-0.5"
        role="toolbar"
        aria-label="Timeline mode switcher"
        data-shell-interaction="true"
        data-timeline-mode-switcher="compact"
      >
        {modeButtons}
        {precisionButton}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-border bg-card/80 p-1"
      role="toolbar"
      aria-label="Phone timeline mode bar"
      data-shell-interaction="true"
      data-timeline-mode-switcher="bar"
    >
      <div className="grid grid-cols-5 gap-1">
        {modeButtons}
        {precisionButton}
      </div>
      <div className="px-2 pt-2 text-[11px] text-muted-foreground">
        {TIMELINE_MODE_HINTS[interactionMode]}
        {precisionEnabled ? ' Precision snapping is on.' : ''}
        {hintSuffix ?? ''}
      </div>
    </div>
  );
}
