import { Component, type ReactNode } from 'react';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import type {
  VideoEditorDiagnosticSeverity,
  VideoEditorDiagnosticSource,
  VideoEditorDiagnosticsStore,
} from '@/tools/video-editor/runtime/diagnostics.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionRenderBoundaryMetadata {
  /** Stable descriptor ID (dialog id, panel id, inspector section id, or slot name). */
  descriptorId: string;
  /** Human-readable descriptor collection: 'slot', 'dialog', 'panel', 'inspectorSection'. */
  descriptorType: 'slot' | 'dialog' | 'panel' | 'inspectorSection';
  /** The slot name when the descriptor is a slot override. */
  slotName?: string;
  /** Extension ID when the descriptor originates from a known package extension. */
  extensionId?: string;
}

export interface ExtensionRenderBoundaryProps {
  metadata: ExtensionRenderBoundaryMetadata;
  /** Fallback rendered when an error is caught. Defaults to a compact inline block. */
  fallback?: ReactNode;
  children: ReactNode;
}

interface ExtensionRenderBoundaryState {
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Diagnostic reporting helper (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Build a diagnostic payload for an extension render/visibility exception.
 * Does NOT require a store — callers in non-React paths can use this to
 * construct the diagnostic and report it later.
 */
export function buildExtensionRenderExceptionDiagnostic(
  error: Error,
  metadata: ExtensionRenderBoundaryMetadata,
  kind: 'render' | 'visibility',
): {
  severity: VideoEditorDiagnosticSeverity;
  source: VideoEditorDiagnosticSource;
  code: string;
  message: string;
  extensionId?: string;
  detail: Record<string, unknown>;
} {
  const code =
    kind === 'render'
      ? 'extension_render_exception'
      : 'extension_visibility_exception';

  const message =
    kind === 'render'
      ? `Extension renderer for "${metadata.descriptorId}" (${metadata.descriptorType}) threw an exception: ${error.message}`
      : `Extension visibility predicate for "${metadata.descriptorId}" (${metadata.descriptorType}) threw an exception: ${error.message}`;

  const detail: Record<string, unknown> = {
    descriptorId: metadata.descriptorId,
    descriptorType: metadata.descriptorType,
    errorMessage: error.message,
    errorName: error.name,
  };

  if (metadata.slotName) detail.slotName = metadata.slotName;
  if (metadata.extensionId) detail.extensionId = metadata.extensionId;

  return {
    severity: 'error',
    source: 'extension-render',
    code,
    message,
    extensionId: metadata.extensionId,
    detail,
  };
}

/** Report a diagnostic to the given store. No-op if store is null/undefined. */
export function reportExtensionRenderDiagnostic(
  store: VideoEditorDiagnosticsStore | null | undefined,
  error: Error,
  metadata: ExtensionRenderBoundaryMetadata,
  kind: 'render' | 'visibility',
): void {
  if (!store) return;
  const diag = buildExtensionRenderExceptionDiagnostic(error, metadata, kind);
  store.report(diag);
}

// ---------------------------------------------------------------------------
// Error boundary (class component — React error boundaries require classes)
// ---------------------------------------------------------------------------

const DEFAULT_FALLBACK = (
  <div
    data-testid="extension-render-fallback"
    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
  >
    Extension content unavailable
  </div>
);

class ExtensionRenderBoundaryInner extends Component<
  ExtensionRenderBoundaryProps & {
    store: VideoEditorDiagnosticsStore | null;
  },
  ExtensionRenderBoundaryState
> {
  static getDerivedStateFromError(error: Error): ExtensionRenderBoundaryState {
    return { error };
  }

  state: ExtensionRenderBoundaryState = { error: null };

  componentDidCatch(error: Error): void {
    reportExtensionRenderDiagnostic(
      this.props.store,
      error,
      this.props.metadata,
      'render',
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback ?? DEFAULT_FALLBACK;
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Public component (hooks into runtime context for the diagnostics store)
// ---------------------------------------------------------------------------

/**
 * Error boundary that wraps extension-rendered UI.
 *
 * When a child renderer throws, the boundary:
 * 1. Catches the exception
 * 2. Reports a `extension_render_exception` diagnostic
 * 3. Renders fallback content (default: compact inline block)
 *
 * The editor shell and other surfaces remain fully functional.
 *
 * @example
 * ```tsx
 * <ExtensionRenderBoundary
 *   metadata={{
 *     descriptorId: 'my-panel',
 *     descriptorType: 'panel',
 *     extensionId: 'com.example.ext',
 *   }}
 * >
 *   <MyExtensionPanel />
 * </ExtensionRenderBoundary>
 * ```
 */
export function ExtensionRenderBoundary({
  metadata,
  fallback,
  children,
}: ExtensionRenderBoundaryProps): ReactNode {
  let store: VideoEditorDiagnosticsStore | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const runtime = useVideoEditorRuntime();
    store = runtime.diagnosticsStore;
  } catch {
    // Context not available (e.g. in tests without a full runtime wrapper).
    // The boundary still works but diagnostics won't be reported.
  }

  return (
    <ExtensionRenderBoundaryInner store={store} metadata={metadata} fallback={fallback}>
      {children}
    </ExtensionRenderBoundaryInner>
  );
}

// ---------------------------------------------------------------------------
// Visibility predicate wrapper (for non-React filter paths)
// ---------------------------------------------------------------------------

/**
 * Wrap a visibility predicate so that if it throws, the diagnostic is reported
 * and the predicate returns `false` (fail-closed: item is hidden).
 *
 * This is intended for use in `resolveVisibleRegistryDescriptors` and other
 * non-React filter paths where a React error boundary cannot be used.
 */
export function wrapVisibilityPredicate(
  store: VideoEditorDiagnosticsStore | null | undefined,
  metadata: ExtensionRenderBoundaryMetadata,
  predicate: (context: any) => boolean,
): (context: any) => boolean {
  return (context: any): boolean => {
    try {
      return predicate(context);
    } catch (error) {
      reportExtensionRenderDiagnostic(
        store,
        error instanceof Error ? error : new Error(String(error)),
        metadata,
        'visibility',
      );
      return false; // fail-closed
    }
  };
}
