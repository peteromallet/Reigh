import { AlertCircle, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import type {
  ReconciliationResult,
  ReconciliationState,
} from '@/tools/video-editor/runtime/extensionSettings';
import { DIAG_SEVERITY_COLOR, DIAG_SEVERITY_ICON } from './diagnosticSeverityStyles';

/** Human-readable label for the reconciliation state badge. */
function reconciliationBadgeLabel(state: ReconciliationState): string {
  switch (state) {
    case 'clean':
      return 'Settings OK';
    case 'repaired':
      return 'Auto-repaired';
    case 'needs-review':
      return 'Needs review';
    case 'blocked':
      return 'Settings blocked';
  }
}

/** Severity-driven color classes for the reconciliation row. */
function reconciliationRowStyle(state: ReconciliationState): string {
  switch (state) {
    case 'clean':
      return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
    case 'repaired':
      return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    case 'needs-review':
      return 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400';
    case 'blocked':
      return 'bg-red-500/10 border-red-500/30 text-red-400';
  }
}

/** Icon component per reconciliation state. */
function ReconciliationIcon({ state }: { state: ReconciliationState }) {
  switch (state) {
    case 'clean':
      return <CheckCircle className="h-3 w-3 shrink-0" />;
    case 'repaired':
      return <Info className="h-3 w-3 shrink-0" />;
    case 'needs-review':
      return <AlertTriangle className="h-3 w-3 shrink-0" />;
    case 'blocked':
      return <AlertCircle className="h-3 w-3 shrink-0" />;
  }
}

/** Reconciliation diagnostic row (T4). */
export function SettingsReconciliationRow({
  extensionId,
  reconciliationResult,
  reconciliationExpanded,
  setReconciliationExpanded,
}: {
  extensionId: string;
  reconciliationResult: ReconciliationResult;
  reconciliationExpanded: boolean;
  setReconciliationExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  /** Count of reconciliation diagnostics that are not schema-adapter noise. */
  const reconciliationDiagCount =
    reconciliationResult.diagnostics.filter(
      (d) => !d.code?.startsWith('settings/unsupported-schema'),
    ).length;

  return (
    <div
      className={`mt-1.5 rounded border px-2 py-1 text-[10px] ${reconciliationRowStyle(reconciliationResult.state)}`}
      data-video-editor-extension-settings-reconciliation={extensionId}
      data-video-editor-extension-settings-reconciliation-state={reconciliationResult.state}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-medium">
          <ReconciliationIcon state={reconciliationResult.state} />
          {reconciliationBadgeLabel(reconciliationResult.state)}
        </span>
        {reconciliationDiagCount > 0 && (
          <button
            type="button"
            onClick={() => setReconciliationExpanded((prev) => !prev)}
            className="inline-flex items-center gap-0.5 text-[10px] underline hover:opacity-80 transition-opacity"
            aria-expanded={reconciliationExpanded}
            aria-label={`${reconciliationExpanded ? 'Hide' : 'Show'} reconciliation details`}
            data-video-editor-extension-settings-reconciliation-toggle={extensionId}
          >
            {reconciliationDiagCount} detail{reconciliationDiagCount !== 1 ? 's' : ''}
            {reconciliationExpanded ? (
              <ChevronDown className="h-2.5 w-2.5" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5" />
            )}
          </button>
        )}
      </div>
      {reconciliationExpanded && reconciliationDiagCount > 0 && (
        <div className="mt-1 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
          {reconciliationResult.diagnostics
            .filter((d) => !d.code?.startsWith('settings/unsupported-schema'))
            .map((diag, idx) => {
              const SevIcon = DIAG_SEVERITY_ICON[diag.severity];
              return (
                <div
                  key={`${diag.code ?? 'diag'}-${idx}`}
                  className="flex items-start gap-1 text-[10px] text-foreground/80"
                >
                  <SevIcon
                    className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${DIAG_SEVERITY_COLOR[diag.severity]}`}
                    aria-hidden="true"
                  />
                  <span>{diag.message}</span>
                </div>
              );
            })}
          {reconciliationResult.droppedUnknownFields.length > 0 && (
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">
              Dropped unknown fields:{' '}
              {reconciliationResult.droppedUnknownFields.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
