/**
 * Standalone diagnostics harness page for Playwright acceptance tests.
 *
 * Creates a diagnostics store, injects diagnostics to simulate various
 * failure modes, renders the DiagnosticsPanel UI, and exposes the store
 * on `window.__videoEditorDiagnosticsStore` for direct inspection.
 *
 * ## Query parameters
 *
 * - `fixture`  Comma-separated fixture names:
 *     `invalid-package`, `incompatible-api`, `duplicate-package-id`,
 *     `conflicting-contribution`, `duplicate-runtime`, `runtime-exception`,
 *     `provider-diagnostics`, `all`, `none`
 *     Default: `all`
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createVideoEditorDiagnosticsStore,
  type VideoEditorDiagnosticsStore,
  type VideoEditorDiagnosticSource,
} from '@/tools/video-editor/runtime/diagnostics.ts';
import { useVideoEditorDiagnostics } from '@/tools/video-editor/hooks/useVideoEditorDiagnostics.ts';
import { DiagnosticsPanel } from '@/tools/video-editor/components/DiagnosticsPanel.tsx';
import { DataProviderWrapper } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import { InMemoryDataProvider } from '@/tools/video-editor/testing/InMemoryDataProvider.ts';
import { AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';

type FixtureName =
  | 'invalid-package'
  | 'incompatible-api'
  | 'duplicate-package-id'
  | 'conflicting-contribution'
  | 'duplicate-runtime'
  | 'runtime-exception'
  | 'provider-diagnostics'
  | 'all'
  | 'none';

const ALL_FIXTURES: FixtureName[] = [
  'invalid-package',
  'incompatible-api',
  'duplicate-package-id',
  'conflicting-contribution',
  'duplicate-runtime',
  'runtime-exception',
  'provider-diagnostics',
];

function injectDiagnostics(
  store: VideoEditorDiagnosticsStore,
  fixtures: readonly FixtureName[],
): void {
  if (fixtures.length === 1 && fixtures[0] === 'none') return;

  const active = fixtures.includes('all')
    ? ALL_FIXTURES
    : fixtures;

  for (const fixture of active) {
    switch (fixture) {
      case 'invalid-package':
        store.report({
          code: 'manifest_schema_invalid',
          severity: 'error',
          source: 'extension-loader',
          message: 'Extension manifest failed schema validation: missing required field "name".',
          extensionId: 'com.example.invalid',
          detail: { missingField: 'name' },
        });
        break;

      case 'incompatible-api':
        store.report({
          code: 'api_version_incompatible',
          severity: 'error',
          source: 'extension-loader',
          message: 'Extension "com.example.incompatible" requires API version 2.0.0 but runtime is 1.0.0.',
          extensionId: 'com.example.incompatible',
          detail: { requiredApiVersion: '2.0.0', runtimeApiVersion: '1.0.0' },
        });
        break;

      case 'duplicate-package-id':
        store.report({
          code: 'duplicate_package_id',
          severity: 'error',
          source: 'extension-loader',
          message: 'Duplicate extension package ID "com.example.duplicate". The first package with this ID has already been loaded; this package is rejected.',
          extensionId: 'com.example.duplicate',
          detail: { duplicateId: 'com.example.duplicate' },
        });
        break;

      case 'conflicting-contribution':
        store.report({
          code: 'contribution_id_mismatch',
          severity: 'warning',
          source: 'extension-loader',
          message: 'Config references slot "statusBar" with id "conflicting-statusbar" but manifest does not declare it.',
          extensionId: 'com.example.conflicting',
          detail: { slot: 'statusBar', id: 'conflicting-statusbar' },
        });
        store.report({
          code: 'contribution_id_mismatch',
          severity: 'warning',
          source: 'extension-loader',
          message: 'Config references dialog "missing-dialog" but manifest does not declare it.',
          extensionId: 'com.example.conflicting',
          detail: { dialog: 'missing-dialog' },
        });
        break;

      case 'duplicate-runtime':
        store.report({
          code: 'duplicate_descriptor_id',
          severity: 'error',
          source: 'extension-runtime',
          message: 'Duplicate extension descriptor ID "duplicate-runtime.dialog" in collection "dialogs". The duplicate was excluded.',
          detail: { descriptorId: 'duplicate-runtime.dialog', collection: 'dialogs' },
        });
        break;

      case 'runtime-exception':
        store.report({
          code: 'extension_render_exception',
          severity: 'error',
          source: 'extension-render',
          message: 'Extension renderer for "fixture.runtime-exception.statusBar" (slot) threw an exception: Fixture: slot renderer intentional exception',
          extensionId: 'fixture.runtime-exception',
          detail: {
            descriptorId: 'fixture.runtime-exception.statusBar',
            descriptorType: 'slot',
            errorMessage: 'Fixture: slot renderer intentional exception',
            errorName: 'Error',
          },
        });
        store.report({
          code: 'extension_visibility_exception',
          severity: 'error',
          source: 'extension-render',
          message: 'Extension visibility predicate for "fixture.runtime-exception.inspector-section" (inspectorSection) threw an exception: Fixture: visibility predicate intentional exception',
          extensionId: 'fixture.runtime-exception',
          detail: {
            descriptorId: 'fixture.runtime-exception.inspector-section',
            descriptorType: 'inspectorSection',
            errorMessage: 'Fixture: visibility predicate intentional exception',
            errorName: 'Error',
          },
        });
        break;

      case 'provider-diagnostics':
        store.report({
          code: 'materialization_download_failed',
          severity: 'warning',
          source: 'asset-materialization',
          message: 'Fixture: asset materialization download failed',
          detail: {
            assetId: 'fixture-asset-1',
            generationId: 'fixture-gen-1',
            reason: 'download_failed',
          },
        });
        store.report({
          code: 'provider_degraded',
          severity: 'warning',
          source: 'provider',
          message: 'Fixture: data provider operating in degraded mode',
          detail: { mode: 'offline', since: new Date().toISOString() },
        });
        break;
    }
  }
}

function exposeStoreOnWindow(store: VideoEditorDiagnosticsStore): void {
  if (typeof window !== 'undefined') {
    (window as any).__videoEditorDiagnosticsStore = store;
  }
}

function DiagnosticsHarnessShell() {
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const diagnostics = useVideoEditorDiagnostics();

  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-background">
      <div className="flex items-center gap-4 mb-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'relative h-9 w-9',
            diagnostics.errorCount > 0 && 'text-red-400',
            diagnostics.errorCount === 0 && diagnostics.warningCount > 0 && 'text-amber-400',
          )}
          onClick={() => setIsDiagnosticsOpen(true)}
          title={`Diagnostics: ${diagnostics.errorCount} error${diagnostics.errorCount === 1 ? '' : 's'}, ${diagnostics.warningCount} warning${diagnostics.warningCount === 1 ? '' : 's'}`}
          data-testid="video-editor-diagnostics-button"
        >
          {diagnostics.errorCount > 0 ? (
            <XCircle className="h-4 w-4" />
          ) : diagnostics.warningCount > 0 ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-muted-foreground/40" />
          )}
          {diagnostics.totalCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-destructive px-[2px] text-[8px] font-bold text-destructive-foreground leading-none">
              {diagnostics.totalCount > 99 ? '99+' : diagnostics.totalCount}
            </span>
          )}
        </Button>
        <span className="text-sm text-muted-foreground">
          Diagnostics Harness — {diagnostics.totalCount} diagnostic{diagnostics.totalCount === 1 ? '' : 's'}
        </span>
      </div>

      <DiagnosticsPanel open={isDiagnosticsOpen} onOpenChange={setIsDiagnosticsOpen} />
    </div>
  );
}

export function DiagnosticsHarnessPage() {
  const [searchParams] = useSearchParams();

  const fixtureRaw = searchParams.get('fixture') || 'all';
  const fixtureNames = fixtureRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is FixtureName => s.length > 0);

  // Stable store — created once, injected with diagnostics, and exposed on window.
  const store = useMemo(() => {
    const s = createVideoEditorDiagnosticsStore();
    injectDiagnostics(s, fixtureNames);
    exposeStoreOnWindow(s);
    return s;
  }, [fixtureRaw]);

  // Provide a minimal runtime context so useVideoEditorDiagnostics can read the store.
  const dp = useMemo(() => new InMemoryDataProvider({ 'harness-timeline': {} }), []);

  const contextValue = useMemo(() => ({
    provider: dp,
    timelineId: 'harness-timeline',
    timelineName: 'Diagnostics Harness',
    userId: null as string | null,
    assetResolver: null as any,
    exporter: null as any,
    hostContext: null as any,
    extensions: {
      slots: {},
      dialogHost: { dialogs: [] },
      registry: { panels: [], inspectorSections: [] },
      packages: {},
      settings: {},
    },
    diagnosticsStore: store,
    auth: null as any,
    project: null as any,
    shots: null as any,
    mediaLightbox: null as any,
    agentChat: null as any,
    toast: null as any,
    telemetry: null as any,
  }), [store, dp]);

  return (
    <DataProviderWrapper value={contextValue}>
      <DiagnosticsHarnessShell />
    </DataProviderWrapper>
  );
}
