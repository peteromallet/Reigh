import { useCallback, useMemo, useState } from 'react';
import { Layers, Loader2, Puzzle, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import type { PackageStateInventoryEntry } from '@/tools/video-editor/runtime/extensionSurface';
import type { ExtensionManifest } from '@reigh/editor-sdk';
import type {
  ExtensionEnablementState,
  ExtensionStateRepository,
} from '@/tools/video-editor/runtime/extensionStateRepository';
import type { ExtensionSettingsNotificationRegistry } from '@/tools/video-editor/runtime/extensionSettingsNotification';
import type { ContributionSummary } from './contributionSummary';
import {
  PackageDiagnosticBadges,
  PackageDiagnosticsSection,
  type PackageDiagnosticSummary,
} from './PackageDiagnostics';
import { PackageSettingsSection } from './PackageSettingsSection';
import { PackageStateBadge } from './PackageStateBadge';

// ---------------------------------------------------------------------------
// Enable/disable save state
// ---------------------------------------------------------------------------

type SaveState = 'idle' | 'saving' | 'error';

const DISABLE_REASON = 'User disabled via extension manager';
const ENABLE_REASON = 'User enabled via extension manager';

// ---------------------------------------------------------------------------
// Package card
// ---------------------------------------------------------------------------

export function PackageCard({
  entry,
  contributionSummary,
  repository,
  onToggleRequest,
  manifest,
  diagnosticSummary,
  settingsNotificationRegistry,
}: {
  entry: PackageStateInventoryEntry;
  contributionSummary: ContributionSummary | null;
  repository: ExtensionStateRepository | null;
  onToggleRequest: () => void;
  manifest?: ExtensionManifest | null;
  diagnosticSummary?: PackageDiagnosticSummary;
  /** T10: Host-visible notification registry for manager/runtime coherence. */
  settingsNotificationRegistry?: ExtensionSettingsNotificationRegistry | null;
}) {
  const { extensionId, packageState, stateReason, packageMetadata } = entry;
  const label = packageMetadata?.label ?? extensionId;
  const version = packageMetadata?.version;
  const publisher = packageMetadata?.publisher;
  const description = packageMetadata?.description;

  // T11: Direct host-supplied extensions are read-only (no install/update/toggle affordances).
  const isDirectEntry = entry.packageSource === 'direct'
    || stateReason === 'Direct host-supplied extension';

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  const isToggleable = (packageState === 'loaded' || packageState === 'disabled-by-user') && !isDirectEntry;
  const isCurrentlyEnabled = packageState === 'loaded';

  // Derive diagnostic counts from summary or fallback to zero
  const diagErrorCount = diagnosticSummary?.errorCount ?? 0;
  const diagWarningCount = diagnosticSummary?.warningCount ?? 0;
  const diagInfoCount = diagnosticSummary?.infoCount ?? 0;
  const hasDiagnostics = diagErrorCount > 0 || diagWarningCount > 0 || diagInfoCount > 0;

  const contribLine = useMemo(() => {
    if (!contributionSummary) return null;
    if (contributionSummary.declared === 0) return null;

    const parts: string[] = [];
    parts.push(`${contributionSummary.declared} contribution${contributionSummary.declared !== 1 ? 's' : ''}`);
    if (contributionSummary.active > 0 && contributionSummary.active < contributionSummary.declared) {
      parts.push(`${contributionSummary.active} active`);
    }
    if (contributionSummary.inactive > 0) {
      parts.push(`${contributionSummary.inactive} inactive`);
    }

    return parts.join(' · ');
  }, [contributionSummary]);

  const handleToggle = useCallback(async () => {
    if (!repository) return;

    const newEnabled = !isCurrentlyEnabled;
    const reason = newEnabled ? ENABLE_REASON : DISABLE_REASON;
    const now = new Date().toISOString();

    const enablementState: ExtensionEnablementState = {
      extensionId,
      enabled: newEnabled,
      lastToggledAt: now,
      toggleReason: reason,
    };

    setSaveState('saving');
    setSaveError(null);

    try {
      await repository.putEnablementState(enablementState);
      setSaveState('idle');
      onToggleRequest();
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : 'Failed to save enablement state');
    }
  }, [extensionId, isCurrentlyEnabled, onToggleRequest, repository]);

  const handleRetry = useCallback(() => {
    setSaveState('idle');
    setSaveError(null);
  }, []);

  return (
    <div
      className="rounded-lg border border-border bg-card/60 p-3 transition-colors"
      data-video-editor-extension-package-id={extensionId}
      data-video-editor-extension-package-state={packageState}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Puzzle className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-foreground">
              {label}
            </span>
            {version && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                v{version}
              </span>
            )}
          </div>
          {publisher && (
            <div className="mt-0.5 text-[11px] text-muted-foreground/70">
              {publisher}
            </div>
          )}
          {description && (
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
              {description}
            </div>
          )}
          {contribLine && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <Layers className="h-3 w-3 shrink-0" />
              <span>{contribLine}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Diagnostic badges — show error/warning/info counts per package */}
          {hasDiagnostics && (
            <PackageDiagnosticBadges
              extensionId={extensionId}
              errorCount={diagErrorCount}
              warningCount={diagWarningCount}
              infoCount={diagInfoCount}
            />
          )}
          {isToggleable && repository && (
            <button
              type="button"
              onClick={
                saveState === 'error'
                  ? handleRetry
                  : saveState === 'saving'
                    ? undefined
                    : handleToggle
              }
              disabled={saveState === 'saving'}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={
                saveState === 'saving'
                  ? `Saving ${extensionId} enablement state`
                  : saveState === 'error'
                    ? `Retry saving ${extensionId} enablement state`
                    : isCurrentlyEnabled
                      ? `Disable ${extensionId}`
                      : `Enable ${extensionId}`
              }
              data-video-editor-extension-toggle={extensionId}
            >
              {saveState === 'saving' ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground">Saving…</span>
                </>
              ) : isCurrentlyEnabled ? (
                <>
                  <ToggleRight className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400">Enabled</span>
                </>
              ) : (
                <>
                  <ToggleLeft className="h-3 w-3 text-zinc-400" />
                  <span className="text-zinc-400">Disabled</span>
                </>
              )}
            </button>
          )}
          {isDirectEntry && (
            <span
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 border-blue-500/30 text-blue-400"
              title="Direct host-supplied extension — read-only"
              data-video-editor-extension-direct-entry={extensionId}
            >
              <Zap className="h-3 w-3" />
              Direct
            </span>
          )}
          <PackageStateBadge state={packageState} />
        </div>
      </div>
      {stateReason && (
        <div className="mt-2 rounded bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
          {stateReason}
        </div>
      )}
      {saveState === 'error' && saveError && (
        <div
          className="mt-2 rounded bg-red-500/10 border border-red-500/30 px-2 py-1 text-[11px] text-red-400"
          role="alert"
          data-video-editor-extension-save-error={extensionId}
        >
          Failed to save: {saveError}
        </div>
      )}

      {/* Expandable diagnostic details — per-package inline diagnostics from DiagnosticCollection */}
      {hasDiagnostics && (
        <PackageDiagnosticsSection
          extensionId={extensionId}
          label={label}
          diagnostics={diagnosticSummary?.diagnostics}
          errorCount={diagErrorCount}
          warningCount={diagWarningCount}
          infoCount={diagInfoCount}
          diagnosticsExpanded={diagnosticsExpanded}
          setDiagnosticsExpanded={setDiagnosticsExpanded}
        />
      )}

      {/* Settings section — visible for all package states (SD3) */}
      <PackageSettingsSection
        extensionId={extensionId}
        repository={repository}
        onRefresh={onToggleRequest}
        manifest={manifest}
        settingsNotificationRegistry={settingsNotificationRegistry}
      />
    </div>
  );
}
