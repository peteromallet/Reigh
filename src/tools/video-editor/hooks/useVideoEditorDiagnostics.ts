/**
 * React hooks for reading from and writing to the video editor diagnostics store.
 *
 * - `useVideoEditorDiagnostics()` returns sorted diagnostics plus severity counts.
 * - `useVideoEditorDiagnosticReporter()` returns an internal reporter bound to the store.
 *
 * Both hooks read the store from `DataProviderContext` and are safe to call
 * without a provider (they fall back to a no-op empty store).
 */

import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { DataProviderContext } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import type { VideoEditorRuntimeContextValue } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import {
  createVideoEditorDiagnosticsStore,
} from '@/tools/video-editor/runtime/diagnostics.ts';
import type {
  VideoEditorDiagnostic,
  VideoEditorDiagnosticReporter,
  VideoEditorDiagnosticSeverity,
  VideoEditorDiagnosticsStore,
} from '@/tools/video-editor/runtime/diagnostics.ts';

// ---------------------------------------------------------------------------
// Fallback store – used when no DataProviderWrapper is mounted
// ---------------------------------------------------------------------------

let _fallbackStore: VideoEditorDiagnosticsStore | undefined;

function getFallbackStore(): VideoEditorDiagnosticsStore {
  if (!_fallbackStore) {
    _fallbackStore = createVideoEditorDiagnosticsStore();
  }
  return _fallbackStore;
}

function useDiagnosticsStore(): VideoEditorDiagnosticsStore {
  const ctx = useContext(DataProviderContext) as VideoEditorRuntimeContextValue | null;
  return ctx?.diagnosticsStore ?? getFallbackStore();
}

// ---------------------------------------------------------------------------
// Severity priority for sort order
// ---------------------------------------------------------------------------

const SEVERITY_PRIORITY: Record<VideoEditorDiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

// ---------------------------------------------------------------------------
// useVideoEditorDiagnostics
// ---------------------------------------------------------------------------

export interface VideoEditorDiagnosticsSnapshot {
  /** All diagnostics, sorted: errors → warnings → info, then by timestamp descending. */
  diagnostics: readonly VideoEditorDiagnostic[];
  /** Count of diagnostics with severity 'error'. */
  errorCount: number;
  /** Count of diagnostics with severity 'warning'. */
  warningCount: number;
  /** Count of diagnostics with severity 'info'. */
  infoCount: number;
  /** Total count. */
  totalCount: number;
}

/**
 * Read the current diagnostics snapshot from the store.
 *
 * Uses `useSyncExternalStore` so React re-renders the consuming component
 * whenever the store mutates (e.g. after `report`, `replaceBySource`, or `clear`).
 */
export function useVideoEditorDiagnostics(): VideoEditorDiagnosticsSnapshot {
  const store = useDiagnosticsStore();

  const diagnostics = useSyncExternalStore(
    store.subscribe.bind(store),
    store.getSnapshot.bind(store),
  );

  const sorted = useMemo(() => {
    if (diagnostics.length <= 1) return diagnostics;
    // Sort: severity priority asc, then timestamp desc
    const copy = [...diagnostics];
    copy.sort((a, b) => {
      const pa = SEVERITY_PRIORITY[a.severity] ?? 99;
      const pb = SEVERITY_PRIORITY[b.severity] ?? 99;
      if (pa !== pb) return pa - pb;
      return b.timestamp.localeCompare(a.timestamp);
    });
    return copy;
  }, [diagnostics]);

  const counts = useMemo(() => {
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    for (const d of diagnostics) {
      if (d.severity === 'error') errorCount++;
      else if (d.severity === 'warning') warningCount++;
      else if (d.severity === 'info') infoCount++;
    }
    return { errorCount, warningCount, infoCount };
  }, [diagnostics]);

  return {
    diagnostics: sorted,
    ...counts,
    totalCount: diagnostics.length,
  };
}

// ---------------------------------------------------------------------------
// useVideoEditorDiagnosticReporter
// ---------------------------------------------------------------------------

/**
 * Return a diagnostics reporter that writes into the store.
 *
 * This hook is for first-party loader/runtime integrations, not extension-authored
 * diagnostic reporting. The returned reporter is stable across rerenders while
 * the store identity is stable.
 */
export function useVideoEditorDiagnosticReporter(): VideoEditorDiagnosticReporter {
  const store = useDiagnosticsStore();

  // The store itself implements the reporter interface; just wrap it in stable callbacks.
  const report = useCallback(
    (diagnostic: Parameters<VideoEditorDiagnosticReporter['report']>[0]) => {
      store.report(diagnostic);
    },
    [store],
  );

  const reportMany = useCallback(
    (diagnostics: Parameters<VideoEditorDiagnosticReporter['reportMany']>[0]) => {
      store.reportMany(diagnostics);
    },
    [store],
  );

  const replaceBySource = useCallback(
    (
      source: Parameters<VideoEditorDiagnosticReporter['replaceBySource']>[0],
      diagnostics: Parameters<VideoEditorDiagnosticReporter['replaceBySource']>[1],
    ) => {
      store.replaceBySource(source, diagnostics);
    },
    [store],
  );

  return useMemo(
    () => ({ report, reportMany, replaceBySource }),
    [report, reportMany, replaceBySource],
  );
}
