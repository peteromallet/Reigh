import { useCallback } from 'react';
import { useSequenceCreatorStore } from '@/tools/video-editor/state/sequenceCreatorStore.ts';
import { smokeRenderSequenceComponent } from '@/tools/video-editor/sequences/headlessRender.ts';
import { useCreateSequenceComponentResource } from '@/tools/video-editor/hooks/useSequenceResources.ts';
import type { ValidatedSequenceDraft } from '@/tools/video-editor/sequences/validation.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';

// T14 — headless smoke-render gate before persisting a generated
// sequence component. Save flow:
//   1. Run smokeRenderSequenceComponent({code, schema, defaults}). If it
//      returns { ok: false }, surface the error inline (NOT a toast — per
//      CLAUDE.md UI conventions: errors-only toasts; panel-inline is
//      correct for this gate) and DO NOT persist.
//   2. On success, call useCreateSequenceComponentResource.mutateAsync
//      with the SequenceComponentMetadata derived from the generated
//      component.
// The gate catches compile errors + obvious runtime errors via
// react-dom/server.renderToString — see headlessRender.ts for the
// FLAG-005 caveat that ThemeProvider/SequenceContext are NOT exercised.
// Smoke-render gate + DB persist + emit a synthetic ValidatedSequenceDraft
// that downstream Insert/Replace builders can consume. This unifies the
// code-path flow with the JSON-path flow (effects pattern: save-on-action,
// not save-as-a-separate-button). Returns the draft pointing at the
// freshly-saved resource's unique clipType so the timeline edit will
// resolve to the correct component via DynamicSequenceRegistry.
export function useSequenceComponentPersistence({
  resolvedConfig,
}: {
  resolvedConfig: ResolvedTimelineConfig | null | undefined;
}) {
  const generatedComponent = useSequenceCreatorStore((s) => s.generatedComponent);
  const generatedComponentSourceClipType = useSequenceCreatorStore((s) => s.generatedComponentSourceClipType);
  const forkPending = useSequenceCreatorStore((s) => s.forkPending);
  const createSequenceComponent = useCreateSequenceComponentResource();

  const persistGeneratedComponent = useCallback(async ():
    Promise<{ ok: true; draft: ValidatedSequenceDraft } | { ok: false; error: string }> => {
    if (!generatedComponent) return { ok: false, error: 'No generated component.' };
    const smoke = await smokeRenderSequenceComponent({
      code: generatedComponent.code,
      schemaJson: generatedComponent.schemaJson,
      defaultsJson: generatedComponent.defaultsJson,
      fps: resolvedConfig?.output.fps ?? 30,
    });
    if (!smoke.ok) {
      return { ok: false, error: `Smoke render failed: ${smoke.error}. Component NOT saved.` };
    }
    const defaultHold = 4;
    // Loaded from library: the resource already exists in DB. Reuse its
    // clipType and skip the create-resource call so we don't double-save.
    if (generatedComponentSourceClipType) {
      return {
        ok: true,
        draft: {
          clipType: generatedComponentSourceClipType,
          hold: defaultHold,
          params: (generatedComponent.defaultsJson ?? {}) as ValidatedSequenceDraft['params'],
        },
      };
    }
    const slug = (generatedComponent.name || 'component')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const uniqueClipType = forkPending?.selectedClipType
      ?? `custom-component:${slug}-${Date.now().toString(36)}`;
    const metadata = {
      name: generatedComponent.name || 'Untitled component',
      slug,
      code: generatedComponent.code,
      schemaJson: generatedComponent.schemaJson,
      defaultsJson: generatedComponent.defaultsJson,
      controlsManifest: generatedComponent.controlsManifest,
      clipType: uniqueClipType,
      themeId: resolvedConfig?.theme ?? '2rp',
      description: generatedComponent.description,
      created_by: { is_you: true },
      is_public: false,
    };
    try {
      await createSequenceComponent.mutateAsync({ metadata });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed.';
      return { ok: false, error: `Save failed: ${message}. Component NOT saved.` };
    }
    return {
      ok: true,
      draft: {
        clipType: uniqueClipType,
        hold: defaultHold,
        params: (generatedComponent.defaultsJson ?? {}) as ValidatedSequenceDraft['params'],
      },
    };
  }, [createSequenceComponent, forkPending, generatedComponent, generatedComponentSourceClipType, resolvedConfig?.output.fps, resolvedConfig?.theme]);

  return persistGeneratedComponent;
}
