import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import type { Diagnostic } from '@reigh/editor-sdk';
import {
  DIAG_SEVERITY_BG,
  DIAG_SEVERITY_COLOR,
  DIAG_SEVERITY_ICON,
} from './diagnosticSeverityStyles';

// ---------------------------------------------------------------------------
// Per-package diagnostic summary (from DiagnosticCollection snapshot)
// ---------------------------------------------------------------------------

export interface PackageDiagnosticSummary {
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly diagnostics: readonly Diagnostic[];
}

/** Diagnostic badges — show error/warning/info counts per package. */
export function PackageDiagnosticBadges({
  extensionId,
  errorCount,
  warningCount,
  infoCount,
}: {
  extensionId: string;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}) {
  return (
    <div className="flex items-center gap-1" data-video-editor-extension-diagnostic-badges={extensionId}>
      {errorCount > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400 tabular-nums"
          title={`${errorCount} error${errorCount === 1 ? '' : 's'}`}
          data-video-editor-extension-diag-count="error"
        >
          <AlertCircle className="h-2.5 w-2.5" aria-hidden="true" />
          {errorCount}
        </span>
      )}
      {warningCount > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-400 tabular-nums"
          title={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}
          data-video-editor-extension-diag-count="warning"
        >
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
          {warningCount}
        </span>
      )}
      {infoCount > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400 tabular-nums"
          title={`${infoCount} info diagnostic${infoCount === 1 ? '' : 's'}`}
          data-video-editor-extension-diag-count="info"
        >
          <Info className="h-2.5 w-2.5" aria-hidden="true" />
          {infoCount}
        </span>
      )}
    </div>
  );
}

/** Expandable diagnostic details — per-package inline diagnostics from DiagnosticCollection. */
export function PackageDiagnosticsSection({
  extensionId,
  label,
  diagnostics,
  errorCount,
  warningCount,
  infoCount,
  diagnosticsExpanded,
  setDiagnosticsExpanded,
}: {
  extensionId: string;
  label: string;
  diagnostics: readonly Diagnostic[] | undefined;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  diagnosticsExpanded: boolean;
  setDiagnosticsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <div className="mt-2 border-t border-border pt-2" data-video-editor-extension-diagnostics={extensionId}>
      <button
        type="button"
        onClick={() => setDiagnosticsExpanded((prev) => !prev)}
        className="inline-flex min-h-6 items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
        aria-expanded={diagnosticsExpanded}
        aria-label={`${diagnosticsExpanded ? 'Hide' : 'Show'} diagnostics for ${label}`}
        data-video-editor-extension-diagnostics-toggle={extensionId}
      >
        {diagnosticsExpanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <AlertCircle className="h-3 w-3" />
        <span>Diagnostics</span>
        <span className="text-[10px] tabular-nums">
          ({errorCount + warningCount + infoCount})
        </span>
      </button>

      {diagnosticsExpanded && (
        <div
          className="mt-1.5 flex flex-col gap-1 max-h-48 overflow-y-auto"
          role="log"
          aria-live="polite"
          aria-label={`${errorCount + warningCount + infoCount} diagnostic${errorCount + warningCount + infoCount === 1 ? '' : 's'} for ${label}`}
          aria-relevant="additions removals"
        >
          {diagnostics?.map((diag, idx) => {
            const SevIcon = DIAG_SEVERITY_ICON[diag.severity];
            const diagId = diag.id ?? `${diag.code}-${idx}`;
            return (
              <div
                key={diagId}
                data-video-editor-extension-diag-item="true"
                data-video-editor-extension-diag-severity={diag.severity}
                data-video-editor-extension-diag-code={diag.code}
                className={`rounded border px-2 py-1 text-[10px] ${DIAG_SEVERITY_BG[diag.severity]}`}
              >
                <div className="flex items-start gap-1.5">
                  <SevIcon
                    className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${DIAG_SEVERITY_COLOR[diag.severity]}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <span className={`break-words ${DIAG_SEVERITY_COLOR[diag.severity]}`}>
                      {diag.message}
                    </span>
                    {diag.code && (
                      <span className="ml-1 text-muted-foreground/60">[{diag.code}]</span>
                    )}
                    {diag.contributionId && (
                      <span className="ml-1 text-muted-foreground/40">
                        in {diag.contributionId}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
