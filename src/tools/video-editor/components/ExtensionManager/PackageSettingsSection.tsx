import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Save,
  Settings,
  Undo2,
  X,
} from 'lucide-react';
import type { ExtensionManifest } from '@reigh/editor-sdk';
import type {
  ExtensionSettingsSnapshot,
  ExtensionStateRepository,
} from '@/tools/video-editor/runtime/extensionStateRepository';
import {
  analyzeManifestSettingsSchema,
  reconcileSettingsSnapshot,
  type ReconciliationResult,
  type ReconciliationState,
} from '@/tools/video-editor/runtime/extensionSettings';
import type { ExtensionSettingsNotificationRegistry } from '@/tools/video-editor/runtime/extensionSettingsNotification';
import {
  SchemaForm,
  type SchemaFormHandle,
} from '@/tools/video-editor/components/SchemaForm/SchemaForm';
import { SettingsReconciliationRow } from './SettingsReconciliationRow';

// ---------------------------------------------------------------------------
// Settings section states
// ---------------------------------------------------------------------------

type SettingsSectionState =
  | 'collapsed'
  | 'loading'
  | 'idle'
  | 'editing'
  | 'saving'
  | 'error';

// ---------------------------------------------------------------------------
// Package settings section (host repository path)
// ---------------------------------------------------------------------------

export function PackageSettingsSection({
  extensionId,
  repository,
  onRefresh,
  manifest,
  settingsNotificationRegistry,
}: {
  extensionId: string;
  repository: ExtensionStateRepository | null;
  onRefresh: () => void;
  manifest?: ExtensionManifest | null;
  /** T10: Host-visible notification registry for manager/runtime coherence. */
  settingsNotificationRegistry?: ExtensionSettingsNotificationRegistry | null;
}) {
  const [sectionState, setSectionState] = useState<SettingsSectionState>('collapsed');
  const [savedSnapshot, setSavedSnapshot] = useState<ExtensionSettingsSnapshot | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationResult | null>(null);
  const [reconciliationExpanded, setReconciliationExpanded] = useState(false);
  // Snapshot of reconciled values at load time, used as the "clean" baseline
  // for dirty detection so repairs (default-fill, coercion) don't look like
  // user edits.
  const baseValuesRef = useRef<Record<string, unknown>>({});
  const schemaFormRef = useRef<SchemaFormHandle>(null);
  const mountedRef = useRef(true);
  // T10: Track whether a save is in flight so the notification reload callback
  // can skip reloading during our own save (avoids redundant re-fetch).
  const savingRef = useRef(false);

  // Fully analyse the manifest schema (T1): returns schema, diagnostics,
  // unsupportedFields, and editable flag.  Replaces the older
  // adaptManifestSettingsSchema call so we can gate the editable surface and
  // feed the analysis into reconcileSettingsSnapshot.
  const schemaAnalysis = useMemo(() => {
    if (!manifest || !manifest.settingsSchema) return null;
    return analyzeManifestSettingsSchema(manifest);
  }, [manifest]);

  // Unsupported schema: manifest has settingsSchema but either the adapter
  // returned no schema at all OR the schema has unsupported constructs
  // ($ref, combinators, arrays, nested objects, conditionals).
  const hasUnsupportedSchema =
    schemaAnalysis !== null && !schemaAnalysis.editable;

  // ---- Reconciliation derived values (T4) — must be before callbacks that
  //      reference them to avoid temporal dead zone. ------------------------
  const reconciliationState: ReconciliationState | null =
    reconciliationResult?.state ?? null;
  const isBlocked = reconciliationState === 'blocked';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // T10: Subscribe to settings change notifications from the shared registry.
  // When runtime code writes through settings.set()/settings.delete(), the
  // manager reloads and reconciles the updated values without remounting.
  useEffect(() => {
    if (!settingsNotificationRegistry || settingsNotificationRegistry.isDisposed) return;

    // Only subscribe when the section is expanded (not collapsed).
    if (sectionState === 'collapsed') return;

    let cancelled = false;

    const handle = settingsNotificationRegistry.subscribeToExtension(
      extensionId,
      async () => {
        // Skip reload during our own save to avoid redundant re-fetch.
        if (!mountedRef.current || cancelled || savingRef.current) return;

        try {
          const snapshot = repository
            ? await repository.getSettingsSnapshot(extensionId)
            : null;

          if (!mountedRef.current || cancelled) return;

          if (manifest) {
            const result = reconcileSettingsSnapshot({ manifest, snapshot });
            setReconciliationResult(result);
            setSavedSnapshot(snapshot);
            setEditValues(result.values);
            baseValuesRef.current = { ...result.values };
          } else {
            setSavedSnapshot(snapshot);
            const fallbackValues = snapshot ? { ...snapshot.values } : {};
            setEditValues(fallbackValues);
            baseValuesRef.current = fallbackValues;
          }
        } catch {
          // Reload failed — silently keep current values.
        }
      },
    );

    return () => {
      cancelled = true;
      handle.dispose();
    };
  }, [sectionState, extensionId, repository, manifest, settingsNotificationRegistry]);

  // Load settings from the repository when expanding.
  const handleExpand = useCallback(async () => {
    if (sectionState === 'loading' || sectionState === 'saving') return;
    if (sectionState !== 'collapsed') {
      setSectionState('collapsed');
      return;
    }

    // Unsupported schemas: load snapshot, run reconciliation for blocker
    // diagnostics, then display read-only preview (no editable controls).
    if (hasUnsupportedSchema) {
      setSectionState('loading');
      setSettingsError(null);
      setReconciliationResult(null);

      try {
        let snapshot: ExtensionSettingsSnapshot | null = null;
        if (repository) {
          snapshot = await repository.getSettingsSnapshot(extensionId);
        }

        if (!mountedRef.current) return;

        // Run reconciliation even for unsupported schemas so the diagnostic
        // row can show why the schema is blocked.
        if (manifest) {
          const result = reconcileSettingsSnapshot({ manifest, snapshot });
          setReconciliationResult(result);
        }

        setSavedSnapshot(snapshot);
        // Display values read-only (empty object if no snapshot).
        const displayValues = snapshot ? { ...snapshot.values } : {};
        setEditValues(displayValues);
        baseValuesRef.current = displayValues;
        setSectionState('idle');
      } catch (err) {
        if (mountedRef.current) {
          setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
          setSectionState('error');
        }
      }
      return;
    }

    setSectionState('loading');
    setSettingsError(null);
    setReconciliationResult(null);

    try {
      let snapshot: ExtensionSettingsSnapshot | null = null;
      if (repository) {
        snapshot = await repository.getSettingsSnapshot(extensionId);
      }

      if (!mountedRef.current) return;

      // Run reconciliation (T3) when a manifest is available so the
      // manager surface always has a classified state + diagnostics.
      if (manifest) {
        const result = reconcileSettingsSnapshot({ manifest, snapshot });
        setReconciliationResult(result);
        setSavedSnapshot(snapshot);
        setEditValues(result.values);
        baseValuesRef.current = { ...result.values };
        setSectionState('idle');
      } else {
        // No manifest — fall back to raw snapshot values (legacy path).
        setSavedSnapshot(snapshot);
        const fallbackValues = snapshot ? { ...snapshot.values } : {};
        setEditValues(fallbackValues);
        baseValuesRef.current = fallbackValues;
        setSectionState('idle');
      }
    } catch (err) {
      if (mountedRef.current) {
        setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
        setSectionState('error');
      }
    }
  }, [sectionState, hasUnsupportedSchema, extensionId, repository, manifest]);

  // Enter editing mode (blocked when reconciliation state is blocked).
  const handleStartEdit = useCallback(() => {
    if (isBlocked) return;
    setSectionState('editing');
    setSettingsError(null);
  }, [isBlocked]);

  // Update a single field value (optimistic, not persisted)
  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Save settings through the repository (blocked when reconciliation is blocked).
  const handleSave = useCallback(async () => {
    if (!repository || isBlocked) return;

    // Validate all SchemaForm fields and focus the first invalid widget.
    if (schemaFormRef.current && !schemaFormRef.current.validateAndFocus()) {
      // Validation failed — focus already directed to the first error.
      return;
    }

    setSectionState('saving');
    setSettingsError(null);
    savingRef.current = true;

    const now = new Date().toISOString();
    const snapshot: ExtensionSettingsSnapshot = {
      extensionId,
      schemaVersion: manifest?.settingsSchema?.version ?? 1,
      values: { ...editValues },
      lastWrittenAt: now,
    };

    try {
      await repository.putSettingsSnapshot(snapshot);
      if (mountedRef.current) {
        setSavedSnapshot(snapshot);
        setSectionState('idle');
        onRefresh();

        // T10: Publish save through the shared notification path so active
        // extensions and other host consumers see the update.
        if (settingsNotificationRegistry && !settingsNotificationRegistry.isDisposed) {
          settingsNotificationRegistry.notifySettingsChanged(extensionId);
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setSettingsError(err instanceof Error ? err.message : 'Failed to save settings');
        setSectionState('error');
      }
    } finally {
      savingRef.current = false;
    }
  }, [extensionId, editValues, onRefresh, repository, manifest, isBlocked, settingsNotificationRegistry]);

  // Cancel: revert to the reconciled baseline values (not raw snapshot).
  const handleCancel = useCallback(() => {
    setEditValues({ ...baseValuesRef.current });
    setSectionState('idle');
    setSettingsError(null);
  }, []);

  // Reset: delete settings, clear reconciliation, re-materialize defaults.
  const handleReset = useCallback(async () => {
    if (!repository || isBlocked) return;
    setSectionState('saving');
    setSettingsError(null);

    try {
      await repository.deleteSettingsSnapshot(extensionId);
      if (mountedRef.current) {
        setSavedSnapshot(null);
        setReconciliationResult(null);
        // Re-materialize: re-run reconciliation with null snapshot
        if (manifest) {
          const result = reconcileSettingsSnapshot({ manifest, snapshot: null });
          setReconciliationResult(result);
          setEditValues(result.values);
          baseValuesRef.current = { ...result.values };
        } else {
          setEditValues({});
          baseValuesRef.current = {};
        }
        setSectionState('idle');
        onRefresh();
      }
    } catch (err) {
      if (mountedRef.current) {
        setSettingsError(err instanceof Error ? err.message : 'Failed to reset settings');
        setSectionState('error');
      }
    }
  }, [extensionId, onRefresh, repository, manifest, isBlocked]);

  // Retry after error
  const handleSettingsRetry = useCallback(() => {
    setSettingsError(null);
    setSectionState('collapsed');
    // Trigger re-expand
    setTimeout(() => {
      if (mountedRef.current) {
        setSectionState('loading');
        handleExpand();
      }
    }, 0);
  }, [handleExpand]);

  const hasSnapshot = savedSnapshot !== null;
  const hasValues = Object.keys(editValues).length > 0;
  // Compare against the reconciled baseline so auto-repairs (default-fill,
  // type coercion) don't falsely flag the form as dirty.
  const isDirty =
    JSON.stringify(editValues) !== JSON.stringify(baseValuesRef.current);

  const settingsKeys = Object.keys(editValues).sort();

  return (
    <div className="mt-2 border-t border-border pt-2" data-video-editor-extension-settings={extensionId}>
      {/* Collapsed: show expand toggle */}
      {sectionState === 'collapsed' && (
        <button
          type="button"
          onClick={handleExpand}
          className="inline-flex min-h-6 items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
          aria-label="Show extension settings"
          data-video-editor-extension-settings-toggle={extensionId}
        >
          <Settings className="h-3 w-3" />
          <span>Settings</span>
          {hasSnapshot && (
            <span className="text-[10px] text-muted-foreground/60">
              ({settingsKeys.length} value{settingsKeys.length !== 1 ? 's' : ''})
            </span>
          )}
          <ChevronRight className="h-3 w-3" />
        </button>
      )}

      {/* Loading */}
      {sectionState === 'loading' && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status" aria-label="Loading settings">
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
          <span>Loading settings…</span>
        </div>
      )}

      {/* ---- Reconciliation diagnostic row (T4) ---- */}
      {reconciliationResult &&
        (sectionState === 'idle' || sectionState === 'editing') && (
          <SettingsReconciliationRow
            extensionId={extensionId}
            reconciliationResult={reconciliationResult}
            reconciliationExpanded={reconciliationExpanded}
            setReconciliationExpanded={setReconciliationExpanded}
          />
        )}

      {/* No settings saved, not editing */}
      {(sectionState === 'idle') && !hasValues && (
        <div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleExpand}
              className="inline-flex min-h-6 items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
              aria-label="Hide extension settings"
            >
              <Settings className="h-3 w-3" />
              <span>Settings</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground/60" data-video-editor-extension-settings-empty={extensionId}>
            No saved settings for this extension.
          </div>
        </div>
      )}

      {/* Idle: show saved values (read-only) */}
      {sectionState === 'idle' && hasValues && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <button
              type="button"
              onClick={handleExpand}
              className="inline-flex min-h-6 items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
              aria-label="Hide extension settings"
            >
              <Settings className="h-3 w-3" />
              <span>Settings</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {!hasUnsupportedSchema && (
              <button
                type="button"
                onClick={handleStartEdit}
                disabled={isBlocked}
                className="min-h-6 rounded px-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Edit extension settings"
                data-video-editor-extension-settings-edit={extensionId}
              >
                Edit
              </button>
            )}
            {hasUnsupportedSchema && (
              <span className="text-[10px] text-yellow-400/80 font-medium">Read-only</span>
            )}
          </div>
          {settingsKeys.map((key) => (
            <div key={key} className="flex items-center gap-2 py-0.5 text-[11px]">
              <span className="font-medium text-muted-foreground min-w-[80px] truncate">{key}</span>
              <span className="text-foreground/80 truncate">{String(editValues[key] ?? '')}</span>
            </div>
          ))}
          {savedSnapshot && (
            <div className="mt-1 text-[10px] text-muted-foreground/50">
              Last saved: {new Date(savedSnapshot.lastWrittenAt).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* Editing: SchemaForm (supported schemas) or fallback key-value editor */}
      {sectionState === 'editing' && (
        <div>
          <div className="flex items-center gap-1 mb-1.5 text-[11px] text-muted-foreground">
            <Settings className="h-3 w-3" />
            <span>Editing settings</span>
          </div>
          {schemaAnalysis?.schema ? (
            <SchemaForm
              ref={schemaFormRef}
              schema={schemaAnalysis.schema}
              values={editValues}
              onChange={handleFieldChange}
            />
          ) : settingsKeys.length > 0 ? (
            settingsKeys.map((key) => (
              <div key={key} className="flex items-center gap-2 py-0.5">
                <label className="text-[11px] font-medium text-muted-foreground min-w-[80px] truncate">
                  {key}
                </label>
                <input
                  type="text"
                  value={String(editValues[key] ?? '')}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-label={`Settings value for ${key}`}
                  data-video-editor-extension-settings-field={key}
                />
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground/60">No settings keys defined.</div>
          )}
          {/* Action buttons */}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || isBlocked}
              className="inline-flex min-h-6 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Save extension settings"
              data-video-editor-extension-settings-save={extensionId}
            >
              <Save className="h-3 w-3" />
              Save
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={!isDirty}
              className="inline-flex min-h-6 items-center gap-1 rounded border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Cancel extension settings changes"
              data-video-editor-extension-settings-cancel={extensionId}
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex min-h-6 items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              aria-label="Reset extension settings"
              data-video-editor-extension-settings-reset={extensionId}
            >
              <Undo2 className="h-3 w-3" />
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Saving */}
      {sectionState === 'saving' && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status" aria-label="Saving settings">
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
          <span>Saving settings…</span>
        </div>
      )}

      {/* Error */}
      {sectionState === 'error' && settingsError && (
        <div
          className="rounded bg-red-500/10 border border-red-500/30 px-2 py-1 text-[11px] text-red-400"
          role="alert"
          data-video-editor-extension-settings-error={extensionId}
        >
          <div className="flex items-center justify-between gap-2">
            <span>Settings error: {settingsError}</span>
            <button
              type="button"
              onClick={handleSettingsRetry}
              className="min-h-6 shrink-0 rounded px-1 text-[10px] underline transition-colors hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              aria-label="Retry extension settings"
              data-video-editor-extension-settings-retry={extensionId}
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
