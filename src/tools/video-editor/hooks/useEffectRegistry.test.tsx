// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  EffectRegistryProvider,
  useEffectRegistryContext,
} from '@/tools/video-editor/effects/registry/EffectRegistryContext.tsx';
import type { EffectRegistrySnapshot } from '@/tools/video-editor/effects/registry/types.ts';
import { createVideoEditorEffectCatalog } from '@/tools/video-editor/lib/effect-catalog.ts';
import { useEffectRegistry } from '@/tools/video-editor/hooks/useEffectRegistry.ts';

/**
 * Mirrors the production wiring in VideoEditorProvider: the effect catalog
 * merges the live registry snapshot into its `effects` list, and that merged
 * list is handed straight back to `useEffectRegistry`. Registering invalidates
 * the snapshot, which rebuilds the catalog, which re-runs registration — the
 * cycle that used to render until React aborted with "Maximum update depth
 * exceeded", leaving the editor (and its timeline) permanently blank.
 */
function RegistryCatalogCycle({
  onRender,
}: {
  onRender: (snapshot: EffectRegistrySnapshot) => void;
}) {
  const { snapshot } = useEffectRegistryContext();
  const catalog = createVideoEditorEffectCatalog({ registryRecords: snapshot.records });
  useEffectRegistry(undefined, catalog.effects);
  onRender(snapshot);
  return null;
}

describe('useEffectRegistry', () => {
  it('settles when the catalog it registers from is derived from the registry', () => {
    let renders = 0;
    render(
      <EffectRegistryProvider>
        <RegistryCatalogCycle onRender={() => { renders += 1; }} />
      </EffectRegistryProvider>,
    );

    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThan(10);
  });

  it('keeps built-in provenance instead of re-registering catalog copies of its own records', () => {
    let latest: EffectRegistrySnapshot | null = null;
    render(
      <EffectRegistryProvider>
        <RegistryCatalogCycle onRender={(snapshot) => { latest = snapshot; }} />
      </EffectRegistryProvider>,
    );

    const records = latest?.records ?? [];
    expect(records.length).toBeGreaterThan(0);
    // Round-tripping a registry record through the catalog loses its component
    // and code, so a re-registered built-in would come back as a `db-resource`
    // compiled from an empty string.
    expect(records.every((record) => record.provenance === 'built-in')).toBe(true);
  });
});
