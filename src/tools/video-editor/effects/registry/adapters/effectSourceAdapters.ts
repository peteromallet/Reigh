import type { FC } from 'react';
import type { EffectComponentProps } from '@/tools/video-editor/effects/entrances.tsx';
import type {
  EffectRegistryProvenance,
  EffectRegistryRecord,
  EffectRegistryRecordStatus,
} from '@/tools/video-editor/effects/registry/types.ts';
import type { ContributionRenderability } from '@/tools/video-editor/runtime/renderability.ts';
import type { ParameterSchema } from '@/tools/video-editor/types/index.ts';

export type EffectComponentMap = Readonly<Record<string, FC<EffectComponentProps>>>;
export type EffectSchemaMap = Readonly<Record<string, ParameterSchema | undefined>>;
export type EffectCodeCompiler = (code: string, effectId: string) => FC<EffectComponentProps>;

export interface EffectAdapterOptions {
  readonly ownerExtensionId?: string;
  readonly renderability?: ContributionRenderability;
  readonly status?: EffectRegistryRecordStatus;
  readonly schemaByEffectId?: EffectSchemaMap;
}

export interface BuiltInEffectAdapterOptions extends EffectAdapterOptions {
  readonly contributionIdPrefix?: string;
}

export interface LocalDraftEffectAdapterOptions extends EffectAdapterOptions {
  readonly contributionIdPrefix?: string;
}

export function normalizeEffectRegistryId(effectId: string): string {
  return effectId.startsWith('custom:') ? effectId.slice('custom:'.length) : effectId;
}

export function createDefaultEffectRenderability(): ContributionRenderability {
  return {
    defaultRoute: 'preview',
    determinism: 'deterministic',
    capabilities: [
      {
        route: 'preview',
        status: 'supported',
        determinism: 'deterministic',
      },
      {
        route: 'browser-export',
        status: 'supported',
        determinism: 'deterministic',
      },
      {
        route: 'worker-export',
        status: 'blocked',
        determinism: 'unknown',
        blockerReason: 'route-unsupported',
        message: 'Effect rendering is not available in worker export by default.',
      },
      {
        route: 'sidecar-export',
        status: 'blocked',
        determinism: 'unknown',
        blockerReason: 'route-unsupported',
        message: 'Effect rendering is not available in sidecar export by default.',
      },
    ],
  };
}

function schemaFor(
  schemaByEffectId: EffectSchemaMap | undefined,
  rawEffectId: string,
  effectId: string,
): ParameterSchema | undefined {
  return schemaByEffectId?.[rawEffectId] ?? schemaByEffectId?.[effectId];
}

function createEffectRecord({
  effectId,
  contributionId,
  component,
  provenance,
  code,
  schema,
  options,
}: {
  effectId: string;
  contributionId: string;
  component: FC<EffectComponentProps>;
  provenance: EffectRegistryProvenance;
  code?: string;
  schema?: ParameterSchema;
  options: EffectAdapterOptions;
}): EffectRegistryRecord {
  return {
    effectId,
    contributionId,
    component,
    ...(schema !== undefined ? { schema } : {}),
    ...(code !== undefined ? { code } : {}),
    provenance,
    ...(options.ownerExtensionId ? { ownerExtensionId: options.ownerExtensionId } : {}),
    renderability: options.renderability ?? createDefaultEffectRenderability(),
    status: options.status ?? 'active',
  };
}

export function builtInEffectsToRegistryRecords(
  effects: EffectComponentMap,
  options: BuiltInEffectAdapterOptions = {},
): EffectRegistryRecord[] {
  const contributionIdPrefix = options.contributionIdPrefix ?? 'built-in:effect';

  return Object.entries(effects).map(([rawEffectId, component]) => {
    const effectId = normalizeEffectRegistryId(rawEffectId);
    return createEffectRecord({
      effectId,
      contributionId: `${contributionIdPrefix}:${effectId}`,
      component,
      provenance: 'built-in',
      schema: schemaFor(options.schemaByEffectId, rawEffectId, effectId),
      options,
    });
  });
}

export function localDraftEffectsToRegistryRecords(
  drafts: Readonly<Record<string, string>>,
  compile: EffectCodeCompiler,
  options: LocalDraftEffectAdapterOptions = {},
): EffectRegistryRecord[] {
  const contributionIdPrefix = options.contributionIdPrefix ?? 'local-draft:effect';

  return Object.entries(drafts).map(([rawEffectId, code]) => {
    const effectId = normalizeEffectRegistryId(rawEffectId);
    return createEffectRecord({
      effectId,
      contributionId: `${contributionIdPrefix}:${effectId}`,
      component: compile(code, effectId),
      provenance: 'local-storage-draft',
      code,
      schema: schemaFor(options.schemaByEffectId, rawEffectId, effectId),
      options,
    });
  });
}
