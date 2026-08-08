import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { DisposeHandle } from '@reigh/editor-sdk';
import {
  continuousEffects,
  entranceEffects,
  exitEffects,
} from '@/tools/video-editor/effects/index.tsx';
import { compileEffect } from '@/tools/video-editor/effects/compileEffect.tsx';
import { loadDraftEffects } from '@/tools/video-editor/effects/effect-store.ts';
import { createEffectRegistry } from '@/tools/video-editor/effects/registry/EffectRegistry.ts';
import { useOptionalEffectRegistryContext } from '@/tools/video-editor/effects/registry/EffectRegistryContext.tsx';
import {
  builtInEffectsToRegistryRecords,
  effectResourcesToRegistryRecords,
  legacyDbEffectsToRegistryRecords,
  localDraftEffectsToRegistryRecords,
} from '@/tools/video-editor/effects/registry/adapters/effectSourceAdapters.ts';
import type { EffectRegistry } from '@/tools/video-editor/effects/registry/types.ts';
import type { EffectResource } from '@/tools/video-editor/hooks/useEffectResources.ts';

const BUILT_INS = {
  ...entranceEffects,
  ...exitEffects,
  ...continuousEffects,
};

/**
 * Registry-sourced catalog entries carry `registryStatus`; DB/resource-backed
 * entries never do. The effect catalog merges the registry snapshot into its
 * `effects` list, so re-registering those entries would (a) overwrite each live
 * record with one recompiled from catalog metadata (built-ins carry no `code`,
 * so they would compile to an error component) and (b) invalidate the registry
 * snapshot, rebuild the catalog and re-enter this hook — an unbounded
 * registry -> catalog -> registry render loop.
 */
function isRegistrySourced(resource: EffectResource): boolean {
  return resource.registryStatus !== undefined;
}

/**
 * Content signature for the registration inputs. The catalog hands back a new
 * array identity whenever the registry snapshot changes, so identity-based
 * effect deps would re-run registration forever. Registration only depends on
 * the effect ids and code, so key the effect on exactly that.
 */
function signature(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries.map(([id, code]) => `${id.length}:${id}:${code.length}:${code}`).join('|');
}

/**
 * Dual-read registry: registers effects from both the legacy `effects` table
 * (keyed by slug) and the newer `resources` table (keyed by resource UUID).
 * Resource-based effects are stored in clips as `custom:{resourceId}`.
 */
export function useEffectRegistry(
  dbEffects: Array<{ slug: string; code: string }> | undefined,
  resourceEffects?: EffectResource[],
): EffectRegistry {
  const draftEffects = useMemo(() => loadDraftEffects(), []);
  const standaloneRegistry = useMemo(() => createEffectRegistry(), []);
  const registryContext = useOptionalEffectRegistryContext();
  const registry = registryContext?.registry ?? standaloneRegistry;

  const subscribe = useCallback((onStoreChange: () => void) => {
    const handle = registry.subscribe(() => onStoreChange());
    return () => handle.dispose();
  }, [registry]);
  const getSnapshot = useCallback(() => registry.getSnapshot(), [registry]);
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    return () => {
      standaloneRegistry.dispose();
    };
  }, [standaloneRegistry]);

  const registrableResources = useMemo(
    () => (resourceEffects ?? []).filter((resource) => !isRegistrySourced(resource)),
    [resourceEffects],
  );

  const dbEffectsSignature = useMemo(
    () => signature((dbEffects ?? []).map((effect) => [effect.slug, effect.code] as const)),
    [dbEffects],
  );
  const resourcesSignature = useMemo(
    () => signature(registrableResources.map((resource) => [resource.id, resource.code ?? ''] as const)),
    [registrableResources],
  );

  // Read the latest inputs inside the effect without making their (unstable)
  // array identities part of its dependency list.
  const latestInputs = useRef({ dbEffects, registrableResources });
  latestInputs.current = { dbEffects, registrableResources };

  useEffect(() => {
    const handles: DisposeHandle[] = [];
    const drafts = Object.entries(draftEffects);
    const db = latestInputs.current.dbEffects ?? [];
    const resources = latestInputs.current.registrableResources;
    if (db.length > 0) {
      console.warn('[EffectRegistry] legacy DB effects are deprecated; migrate to resource-based effects via useEffectResources.');
    }

    const records = [
      ...builtInEffectsToRegistryRecords(BUILT_INS),
      ...localDraftEffectsToRegistryRecords(
        Object.fromEntries(drafts),
        (code) => compileEffect(code),
      ),
      ...legacyDbEffectsToRegistryRecords(
        db,
        (code) => compileEffect(code),
      ),
      ...effectResourcesToRegistryRecords(
        resources,
        (code) => compileEffect(code),
      ),
    ];

    records.forEach((record) => {
      handles.push(registry.register(record));
    });

    return () => {
      handles.forEach((handle) => handle.dispose());
    };
  }, [dbEffectsSignature, draftEffects, registry, resourcesSignature]);

  return registry;
}
