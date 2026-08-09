import type { SetStateAction } from 'react';
import { validateControlsManifest } from '@/tools/video-editor/sequences/controlsManifest.ts';
import type { GeneratedComponent } from '@/tools/video-editor/state/sequenceCreatorStore.ts';
import type { AllowedSequenceAsset } from '@/tools/video-editor/sequences/generation.ts';
import { CodePathParamEditor } from './CodePathParamEditor.tsx';
import { ControlsManifestLayout } from './ControlsManifestLayout.tsx';

/**
 * Code-path controls for a generated component. Components that declared a
 * controls manifest get the manifest layout; components saved before the
 * manifest existed fall back to the JSON-schema-driven editor so they keep
 * working without forcing a regeneration.
 */
export function SequenceCreatorComponentControls({
  generatedComponent,
  allowedAssets,
  allowedAssetKeys,
  setGeneratedComponent,
}: {
  generatedComponent: GeneratedComponent;
  allowedAssets: AllowedSequenceAsset[];
  allowedAssetKeys: string[];
  setGeneratedComponent: (next: SetStateAction<GeneratedComponent | null>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">
          {generatedComponent.name || 'Generated component'}
        </div>
        {generatedComponent.description && (
          <div className="text-xs text-muted-foreground">
            {generatedComponent.description}
          </div>
        )}
      </div>
      {(() => {
        // Render controls via the new manifest layout when the
        // component declared one (AI-generated post-manifest).
        // Backwards compat: components saved before the manifest
        // existed fall back to the JSON-schema-driven editor so
        // they keep working without forcing a regeneration.
        const manifestResult = generatedComponent.controlsManifest
          ? validateControlsManifest(generatedComponent.controlsManifest, { code: generatedComponent.code })
          : null;
        if (manifestResult?.ok) {
          return (
            <ControlsManifestLayout
              manifest={manifestResult.manifest}
              values={generatedComponent.defaultsJson as Record<string, unknown>}
              onChange={(next) => setGeneratedComponent((prev) => (
                prev ? { ...prev, defaultsJson: next } : prev
              ))}
            />
          );
        }
        return (
          <CodePathParamEditor
            schemaJson={generatedComponent.schemaJson}
            values={generatedComponent.defaultsJson as Record<string, unknown>}
            allowedAssetKeys={allowedAssetKeys}
            allowedAssets={allowedAssets}
            onChange={(next) => setGeneratedComponent((prev) => (
              prev ? { ...prev, defaultsJson: next } : prev
            ))}
          />
        );
      })()}
    </div>
  );
}
