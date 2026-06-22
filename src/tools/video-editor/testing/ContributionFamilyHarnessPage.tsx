/**
 * Dev-only contribution family harness for Playwright acceptance tests.
 *
 * This page intentionally renders small, deterministic selector rows for the
 * public M5 families without depending on editor layout or visible copy.
 */

import { useMemo } from 'react';
import { ExtensionLoader } from '@/tools/video-editor/runtime/extensionLoader.ts';
import { InMemoryExtensionStateRepository } from '@/tools/video-editor/runtime/extensionStateRepository.ts';
import {
  resolveVideoEditorExtensionRuntimeWithDiagnostics,
  type VideoEditorRenderContext,
} from '@/tools/video-editor/runtime/extensionSurface.ts';
import type { ExtensionCommandContribution } from '@/tools/video-editor/runtime/extensionManifest.ts';
import {
  FAMILY_FIXTURE_IDS,
  familyLoaderDiagnosticPackages,
  familyPositivePackages,
  familyRuntimeDiagnosticConfigs,
  familySettingsValidState,
} from '@/tools/video-editor/testing/extensions/family-fixtures/index.tsx';

function commandRows(commands: readonly ExtensionCommandContribution[]) {
  return (
    <>
      {commands.map((command) => (
        <div
          key={`palette:${command.id}`}
          data-testid="family-command-palette-entry"
          data-command-id={command.id}
          data-extension-id={command.extensionId}
        />
      ))}
      {commands
        .filter((command) => command.menu?.context)
        .map((command) => (
          <div
            key={`context:${command.id}`}
            data-testid="family-command-context-entry"
            data-command-id={command.id}
            data-command-context={command.menu?.context}
            data-extension-id={command.extensionId}
          />
        ))}
      {commands
        .filter((command) => command.keybinding?.key)
        .map((command) => (
          <div
            key={`keybinding:${command.id}`}
            data-testid="family-command-keybinding-entry"
            data-command-id={command.id}
            data-keybinding={command.keybinding?.key}
            data-extension-id={command.extensionId}
          />
        ))}
    </>
  );
}

export function ContributionFamilyHarnessPage() {
  const { loadResult, runtimeResult } = useMemo(() => {
    const repository = new InMemoryExtensionStateRepository();
    repository.setState(FAMILY_FIXTURE_IDS.settings, familySettingsValidState);

    const loader = new ExtensionLoader(
      [...familyPositivePackages, ...familyLoaderDiagnosticPackages],
      repository,
    );
    const loaded = loader.load();

    return {
      loadResult: loaded,
      runtimeResult: resolveVideoEditorExtensionRuntimeWithDiagnostics([
        ...loaded.configs,
        ...familyRuntimeDiagnosticConfigs,
      ]),
    };
  }, []);

  const diagnostics = [...loadResult.diagnostics, ...runtimeResult.diagnostics];
  const renderContext = {} as VideoEditorRenderContext;

  return (
    <main data-testid="video-editor-family-harness">
      <section data-testid="family-surfaces">
        {Object.entries(runtimeResult.runtime.slots).map(([slotName, renderer]) => (
          <div
            key={slotName}
            data-testid="family-surface-container"
            data-contribution-family="surfaces"
            data-video-editor-surface-kind="slot"
            data-video-editor-slot-name={slotName}
          >
            {renderer?.(renderContext)}
          </div>
        ))}
        {runtimeResult.runtime.dialogHost.dialogs.map((dialog) => (
          <div
            key={dialog.id}
            data-testid="family-surface-container"
            data-contribution-family="surfaces"
            data-video-editor-surface-kind="dialog"
            data-contribution-id={dialog.id}
          >
            {dialog.render(renderContext)}
          </div>
        ))}
        {runtimeResult.runtime.registry.panels.map((panel) => (
          <div
            key={panel.id}
            data-testid="family-surface-container"
            data-contribution-family="surfaces"
            data-video-editor-surface-kind="asset-panel"
            data-contribution-id={panel.id}
          >
            {panel.render(renderContext)}
          </div>
        ))}
        {runtimeResult.runtime.registry.inspectorSections.map((section) => (
          <div
            key={section.id}
            data-testid="family-surface-container"
            data-contribution-family="surfaces"
            data-video-editor-surface-kind="inspector-section"
            data-contribution-id={section.id}
          >
            {section.render(renderContext)}
          </div>
        ))}
      </section>

      <section data-testid="family-commands">
        {commandRows(loadResult.commands)}
      </section>

      <section data-testid="family-settings">
        {Object.entries(runtimeResult.runtime.settings).map(([extensionId, settings]) => (
          <form
            key={extensionId}
            data-testid="family-settings-form"
            data-extension-id={extensionId}
          >
            {Object.entries(settings).map(([key, value]) => (
              <label
                key={key}
                data-testid="family-settings-row"
                data-extension-id={extensionId}
                data-settings-key={key}
              >
                <input name={key} readOnly value={JSON.stringify(value)} />
              </label>
            ))}
          </form>
        ))}
      </section>

      <section data-testid="family-diagnostics">
        {diagnostics.map((diagnostic, index) => (
          <div
            key={`${diagnostic.code}:${diagnostic.extensionId ?? 'runtime'}:${index}`}
            data-testid="video-editor-diagnostic-row"
            data-diagnostic-code={diagnostic.code}
            data-diagnostic-severity={
              (diagnostic as { kind?: string; severity?: string }).kind
              ?? (diagnostic as { kind?: string; severity?: string }).severity
            }
            {...(diagnostic.extensionId ? { 'data-diagnostic-extension-id': diagnostic.extensionId } : {})}
          />
        ))}
      </section>
    </main>
  );
}
