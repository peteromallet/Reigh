import { AudioWaveform } from 'lucide-react';
import { SelectValue } from '@/shared/components/ui/select.tsx';
import { getDefaultValues } from '@/tools/video-editor/components/ParameterControls.tsx';
import type { EffectResource } from '@/tools/video-editor/hooks/useEffectResources.ts';
import { NO_EFFECT } from './clip-panel-primitives.tsx';

/** Find a resource-based effect by its `custom:{id}` type string */
export function findEffectResourceByType(
  type: string | undefined,
  effects: EffectResource[],
): EffectResource | undefined {
  if (!type?.startsWith('custom:')) return undefined;
  const id = type.slice(7);
  return effects.find((e) => e.id === id);
}

export function getDefaultEffectParams(
  type: string | undefined,
  effects: EffectResource[],
): Record<string, unknown> | undefined {
  const effect = findEffectResourceByType(type, effects);
  return effect?.parameterSchema ? getDefaultValues(effect.parameterSchema) : undefined;
}

export function getMergedEffectParams(
  effect: EffectResource | undefined,
  storedParams: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...getDefaultValues(effect?.parameterSchema ?? []),
    ...(storedParams ?? {}),
  };
}

/** Returns a display label for an effect type — handles both built-in and custom */
export function getEffectDisplayLabel(type: string | undefined, effects: EffectResource[]): string | null {
  if (!type || type === NO_EFFECT) return null;
  if (!type.startsWith('custom:')) return type; // built-in: just use the name
  const effect = findEffectResourceByType(type, effects);
  if (effect) return effect.name;
  const id = type.slice(7);
  return `Effect ${id.slice(0, 8)}… (missing)`;
}

/** Check if a custom effect type is already in the resource list */
export function isCustomEffectInList(type: string | undefined, categoryEffects: EffectResource[]): boolean {
  if (!type?.startsWith('custom:')) return true;
  const id = type.slice(7);
  return categoryEffects.some((e) => e.id === id);
}

export function EffectSelectValue({ type, effects }: { type: string | undefined; effects: EffectResource[] }) {
  const label = getEffectDisplayLabel(type, effects);
  return <SelectValue placeholder="None">{label ?? 'None'}</SelectValue>;
}

/** Check if an effect resource's registry status is 'error' (invalid schema, etc.). */
export function isEffectInError(effect: EffectResource): boolean {
  return effect.registryStatus === 'error';
}

/** Check if an effect resource is read-only (bundled-extension per SD3). */
export function isReadOnlyEffect(effect: EffectResource): boolean {
  return effect.readOnly === true;
}

/** Returns a short provenance label for display in effect selectors. */
export function getProvenanceLabel(effect: EffectResource): string | null {
  switch (effect.provenance) {
    case 'bundled-extension':
      return 'Extension';
    case 'external-catalog':
      return 'Catalog';
    case 'db-resource':
      return 'DB';
    case 'ai-generated':
      return 'AI';
    case 'local-storage-draft':
      return 'Draft';
    case 'trusted-loader':
      return 'Trusted';
    default:
      return null;
  }
}

/**
 * Returns a compact summary of export capability status for an applied effect.
 * Shows which routes are blocked so users see export limitations immediately after apply.
 */
export function getBlockedRoutes(effect: EffectResource): string[] {
  if (!effect.renderability?.capabilities) return [];
  return effect.renderability.capabilities
    .filter((cap) => cap.route !== 'preview' && cap.status === 'blocked')
    .map((cap) => cap.route);
}

/** Check if an effect is preview-only (browser-export and worker-export both blocked). */
export function isPreviewOnly(effect: EffectResource): boolean {
  if (!effect.renderability?.capabilities) return false;
  const hasBrowserExport = effect.renderability.capabilities.some(
    (cap) => cap.route === 'browser-export' && cap.status === 'supported',
  );
  const hasWorkerExport = effect.renderability.capabilities.some(
    (cap) => cap.route === 'worker-export' && cap.status === 'supported',
  );
  const hasPreview = effect.renderability.capabilities.some(
    (cap) => cap.route === 'preview' && cap.status === 'supported',
  );
  return hasPreview && !hasBrowserExport && !hasWorkerExport;
}

export function hasParameterSchema(effect: EffectResource | undefined): effect is EffectResource & { parameterSchema: NonNullable<EffectResource['parameterSchema']> } {
  return Boolean(effect?.parameterSchema?.length);
}

/** Check if stored params differ from schema defaults (for reset-to-defaults affordance). */
export function hasCustomParams(
  effect: EffectResource | undefined,
  storedParams: Record<string, unknown> | undefined,
): boolean {
  if (!effect?.parameterSchema?.length) return false;
  const defaults = getDefaultValues(effect.parameterSchema);
  const params = storedParams ?? {};
  const allKeys = new Set([...Object.keys(defaults), ...Object.keys(params)]);
  for (const key of allKeys) {
    if (JSON.stringify(params[key]) !== JSON.stringify(defaults[key])) {
      return true;
    }
  }
  return false;
}

export function isAudioReactiveEffect(effect: EffectResource): boolean {
  return effect.code?.includes('useAudioReactive') || effect.code?.includes('useAudioParam')
    || effect.parameterSchema?.some((p) => p.type === 'audio-binding') === true;
}

export function AudioReactiveIcon() {
  return <AudioWaveform className="inline-block h-3 w-3 shrink-0 text-muted-foreground" />;
}
