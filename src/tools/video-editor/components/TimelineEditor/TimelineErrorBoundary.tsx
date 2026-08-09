/**
 * TimelineErrorBoundary — host-owned React error boundary for the timeline
 * editor region itself.
 *
 * Extension contributions have had containment since M1 (`HostContributionErrorBoundary`
 * in `runtime/ContributionErrorBoundary.tsx`); the *host* timeline had none. A render
 * throw anywhere under `TimelineEditor` — one malformed clip in `ClipAction`, a bad row
 * in `TrackListRenderer` — unmounted the whole editor, including the toolbar you would
 * have used to undo the edit that produced it.
 *
 * This boundary is deliberately scoped to the timeline region only. The shell mounts it
 * around `<TimelineEditor>` inside each layout branch, so the toolbar, history controls,
 * preview and inspector all survive a timeline crash and remain usable.
 *
 * Recovery reuses the recovery-key pattern from `ContributionErrorBoundary`: "Reload
 * editor" bumps a monotonic epoch that is both the boundary's `recoveryKey` and the
 * `key` of the wrapped subtree, so the children are torn down and re-mounted from
 * scratch rather than re-rendered over stale state.
 */

import { Component, Fragment, useCallback, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export interface TimelineErrorInfo {
  error: Error;
  componentStack: string | null;
}

interface TimelineErrorBoundaryInnerProps {
  /** Bumped by the host to force a fresh render after a caught error. */
  recoveryKey: string;
  /** User-visible "Reload editor" action. */
  onReload: () => void;
  /** Called when the boundary catches an error (host diagnostics sink). */
  onError?: (info: TimelineErrorInfo) => void;
  children: ReactNode;
}

interface TimelineErrorBoundaryState {
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Fallback UI
// ---------------------------------------------------------------------------

function TimelineErrorFallback({
  error,
  onReload,
}: {
  error: Error | null;
  onReload: () => void;
}) {
  return (
    <div
      role="alert"
      data-video-editor-timeline-error="true"
      className="flex h-full min-h-0 w-full items-center justify-center overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <div className="flex max-w-md items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">Timeline failed to render</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            The rest of the editor is still live — your history and unsaved edits are intact.
            Reloading re-mounts the timeline only.
          </p>
          {error && (
            <div
              className="mt-1.5 truncate text-[11px] text-destructive/80"
              title={error.message}
            >
              {error.message}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onReload}
          data-video-editor-timeline-reload="true"
          className="ml-auto min-h-11 shrink-0 rounded px-2 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 motion-reduce:transition-none"
        >
          <RefreshCw className="mr-1 inline h-3 w-3" />
          Reload editor
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boundary (class component — React error boundaries must be classes)
// ---------------------------------------------------------------------------

class TimelineErrorBoundaryInner extends Component<
  TimelineErrorBoundaryInnerProps,
  TimelineErrorBoundaryState
> {
  /** Last recovery key seen by this boundary — used to detect an explicit reset. */
  private _lastRecoveryKey: string;

  constructor(props: TimelineErrorBoundaryInnerProps) {
    super(props);
    this.state = { error: null };
    this._lastRecoveryKey = props.recoveryKey;
  }

  static getDerivedStateFromError(error: Error): TimelineErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const componentStack = errorInfo.componentStack ?? null;

    if (typeof console !== 'undefined') {
      console.error(
        '[Timeline render error] the timeline editor region threw during render:',
        error,
        componentStack ? `\nComponent stack:\n${componentStack}` : '',
      );
    }

    this.props.onError?.({ error, componentStack });
  }

  componentDidUpdate(prevProps: TimelineErrorBoundaryInnerProps, prevState: TimelineErrorBoundaryState): void {
    if (prevState.error === null) return;

    // Only an explicit recovery-key change clears the error. Resetting on any
    // children-reference change would crash→recover→crash on every parent
    // re-render while the underlying clip is still malformed.
    if (this.props.recoveryKey !== this._lastRecoveryKey) {
      this._lastRecoveryKey = this.props.recoveryKey;
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return <TimelineErrorFallback error={this.state.error} onReload={this.props.onReload} />;
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Host wrapper — owns the recovery epoch
// ---------------------------------------------------------------------------

export interface TimelineErrorBoundaryProps {
  /** Called when the boundary catches an error (host diagnostics sink). */
  onError?: (info: TimelineErrorInfo) => void;
  children: ReactNode;
}

/**
 * Wraps the timeline region in {@link TimelineErrorBoundaryInner} and owns the
 * recovery epoch. The epoch is both the boundary's `recoveryKey` and the `key` of
 * the wrapped subtree, so "Reload editor" produces a genuine re-mount.
 */
export function TimelineErrorBoundary({ onError, children }: TimelineErrorBoundaryProps) {
  const [epoch, setEpoch] = useState(0);
  const handleReload = useCallback(() => setEpoch((value) => value + 1), []);

  return (
    <TimelineErrorBoundaryInner
      recoveryKey={String(epoch)}
      onReload={handleReload}
      onError={onError}
    >
      {/* Keying the fragment on the epoch tears the subtree down and re-mounts
          it, rather than re-rendering it over the state that crashed. */}
      <Fragment key={epoch}>{children}</Fragment>
    </TimelineErrorBoundaryInner>
  );
}
