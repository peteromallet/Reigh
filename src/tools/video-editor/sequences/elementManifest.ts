export type ElementManifestVersion = '1';

export type ElementManifestJsonPrimitive = string | number | boolean | null;

export type ElementManifestJsonValue =
  | ElementManifestJsonPrimitive
  | ElementManifestJsonObject
  | ElementManifestJsonArray;

export type ElementManifestJsonObject = {
  [key: string]: ElementManifestJsonValue;
};

export type ElementManifestJsonArray = readonly ElementManifestJsonValue[];

export type ElementManifestSource = 'reigh' | 'artagents' | 'unknown';

export type ElementManifestKindBlock = {
  source: ElementManifestSource;
  type: string;
  namespace?: string;
  label?: string;
};

export type ElementManifestRuntimeBlock = {
  renderer: 'react-sequence-component' | 'artagents-element' | 'unknown';
  source?: 'inline-code' | 'file' | 'package' | 'database' | 'unknown';
  code?: string;
  modulePath?: string;
  exportName?: string;
  clipType?: string;
  themeId?: string;
  dependencies?: readonly ElementManifestRuntimeDependency[];
  capabilities?: ElementManifestRuntimeCapabilities;
};

export type ElementManifestRuntimeDependency = {
  name: string;
  version?: string;
  runtime?: string;
  optional?: boolean;
};

export type ElementManifestRuntimeCapabilities = {
  browserRender?: boolean;
  workerRender?: boolean;
  externalRender?: boolean;
  preview?: 'browser' | 'placeholder' | 'unknown';
  [key: string]: ElementManifestJsonValue | undefined;
};

export type ElementManifestInputType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'color'
  | 'enum'
  | 'select'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'asset'
  | 'asset-list'
  | 'object'
  | 'array'
  | 'json';

export type ElementManifestInputBlock = {
  id: string;
  type: ElementManifestInputType;
  label?: string;
  description?: string;
  required?: boolean;
  default?: ElementManifestJsonValue;
  options?: readonly ElementManifestInputOption[];
  constraints?: ElementManifestInputConstraints;
  accepts?: readonly ElementManifestMediaType[];
  componentParam?: string;
};

export type ElementManifestInputOption = {
  label?: string;
  value: string | number | boolean;
};

export type ElementManifestMediaType = 'image' | 'video' | 'audio' | 'text' | 'unknown';

export type ElementManifestInputConstraints = {
  min?: number;
  max?: number;
  step?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
};

export type ElementManifestAssetSlotBlock = {
  id: string;
  label: string;
  mediaType: 'image' | 'video';
  required: boolean;
  minItems: number;
  maxItems: number;
  description?: string;
};

export type ElementManifestControlBlock = ElementManifestJsonObject;

export type ElementManifestContractBlock = {
  schema?: ElementManifestJsonObject;
  defaults?: ElementManifestJsonObject;
  inputs?: readonly ElementManifestInputBlock[];
  controlsManifest?: readonly ElementManifestControlBlock[];
  assetSlots?: readonly ElementManifestAssetSlotBlock[];
  outputs?: readonly ElementManifestOutputBlock[];
};

export type ElementManifestOutputBlock = {
  id: string;
  type: ElementManifestMediaType | 'composition' | 'metadata' | 'json';
  label?: string;
  description?: string;
};

export type ElementManifestCatalogBlock = {
  name: string;
  slug?: string;
  description?: string;
  whenToUse?: string;
  keywords?: readonly string[];
  tags?: readonly string[];
  packId?: string;
  category?: string;
  thumbnailUrl?: string;
  examples?: readonly ElementManifestCatalogExample[];
};

export type ElementManifestCatalogExample = {
  label?: string;
  params?: ElementManifestJsonObject;
  assetSlotBindings?: Record<string, string[]>;
};

export type ElementManifestProvenanceBlock = {
  source: ElementManifestSource;
  resourceId?: string;
  resourceType?: string;
  packId?: string;
  filePath?: string;
  generatedBy?: string;
  createdBy?: ElementManifestCreatedByBlock;
  createdAt?: string;
  updatedAt?: string;
  importId?: string;
};

export type ElementManifestCreatedByBlock = {
  isYou?: boolean;
  username?: string;
  userId?: string;
};

export type ElementManifestCompatibilityBlock = {
  aliases?: readonly string[];
  reigh?: ElementManifestReighCompatibilityBlock;
  artAgents?: ElementManifestArtAgentsCompatibilityBlock;
};

export type ElementManifestReighCompatibilityBlock = {
  clipType?: string;
  themeId?: string;
  controlsManifestAlias?: 'controlsManifest';
  assetSlotsAlias?: 'assetSlots';
  schemaAlias?: 'schemaJson';
  defaultsAlias?: 'defaultsJson';
};

export type ElementManifestArtAgentsCompatibilityBlock = {
  id?: string;
  kind?: string;
  packId?: string;
  runtime?: string;
};

export type ElementManifestV1 = {
  version: ElementManifestVersion;
  id: string;
  kind: ElementManifestKindBlock;
  runtime: ElementManifestRuntimeBlock;
  contract: ElementManifestContractBlock;
  catalog: ElementManifestCatalogBlock;
  provenance: ElementManifestProvenanceBlock;
  compatibility: ElementManifestCompatibilityBlock;
};

export type SequenceComponentMetadataLike = {
  name: string;
  slug: string;
  code: string;
  schemaJson: object;
  defaultsJson: object;
  controlsManifest?: readonly unknown[];
  assetSlots?: readonly unknown[];
  clipType: string;
  themeId: string;
  description: string;
  created_by?: {
    is_you?: boolean;
    username?: string;
  };
  is_public?: boolean;
  elementManifest?: ElementManifestV1;
};

export type SequenceComponentMetadataManifestOptions = {
  id?: string;
  resourceId?: string;
  resourceType?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  generatedBy?: string;
};

export type SequenceComponentMetadataToElementManifest = (
  metadata: SequenceComponentMetadataLike,
  options?: SequenceComponentMetadataManifestOptions,
) => ElementManifestV1;

export type ElementManifestToSequenceComponentMetadata = (
  manifest: ElementManifestV1,
  existingMetadata?: Partial<SequenceComponentMetadataLike>,
) => SequenceComponentMetadataLike;

export type ArtAgentsElementManifestLike = ElementManifestJsonObject;

export type ArtAgentsElementManifestToElementManifest = (
  manifest: ArtAgentsElementManifestLike,
  options?: {
    idPrefix?: string;
    packId?: string;
    filePath?: string;
  },
) => ElementManifestV1;

export type ElementManifestAdapterFunctions = {
  sequenceComponentMetadataToElementManifest: SequenceComponentMetadataToElementManifest;
  elementManifestToSequenceComponentMetadata: ElementManifestToSequenceComponentMetadata;
  artAgentsElementManifestToElementManifest: ArtAgentsElementManifestToElementManifest;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const nonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const toJsonValue = (value: unknown): ElementManifestJsonValue | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry) ?? null);
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const result: ElementManifestJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const jsonEntry = toJsonValue(entry);
    if (jsonEntry !== undefined) {
      result[key] = jsonEntry;
    }
  }
  return result;
};

const toJsonObject = (value: unknown): ElementManifestJsonObject => {
  const json = toJsonValue(value);
  return isRecord(json) && !Array.isArray(json) ? json : {};
};

const toJsonObjectArray = (value: unknown): ElementManifestJsonObject[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.map(toJsonObject);
};

const toStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .map(nonEmptyString)
    .filter((entry): entry is string => Boolean(entry));
  return strings.length > 0 ? strings : undefined;
};

const uniqueStrings = (values: readonly (string | undefined)[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const slugify = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'element';
};

const readRecord = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const entry = value[key];
  return isRecord(entry) ? entry : undefined;
};

const readString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  return nonEmptyString(value[key]);
};

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const stringValue = nonEmptyString(value);
    if (stringValue) return stringValue;
  }
  return undefined;
};

const normalizeInputType = (value: unknown): ElementManifestInputType => {
  const type = nonEmptyString(value)?.toLowerCase();
  switch (type) {
    case 'str':
    case 'string':
      return 'string';
    case 'int':
    case 'integer':
      return 'integer';
    case 'float':
    case 'number':
      return 'number';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'colour':
    case 'color':
      return 'color';
    case 'enum':
      return 'enum';
    case 'select':
      return 'select';
    case 'textarea':
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'asset':
      return 'asset';
    case 'assets':
    case 'asset-list':
    case 'asset_list':
      return 'asset-list';
    case 'object':
      return 'object';
    case 'array':
    case 'list':
      return 'array';
    case 'json':
      return 'json';
    default:
      return 'json';
  }
};

const normalizeInputOption = (value: unknown): ElementManifestInputOption | undefined => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { value };
  }
  if (!isRecord(value)) return undefined;
  const optionValue = value.value;
  if (
    typeof optionValue !== 'string'
    && typeof optionValue !== 'number'
    && typeof optionValue !== 'boolean'
  ) {
    return undefined;
  }
  return {
    value: optionValue,
    ...(nonEmptyString(value.label) ? { label: nonEmptyString(value.label) } : {}),
  };
};

const normalizeInputs = (value: unknown): ElementManifestInputBlock[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const inputs = value.flatMap((entry): ElementManifestInputBlock[] => {
    if (!isRecord(entry)) return [];
    const id = firstString(entry.id, entry.name, entry.key);
    if (!id) return [];
    const options = Array.isArray(entry.options)
      ? entry.options
        .map(normalizeInputOption)
        .filter((option): option is ElementManifestInputOption => Boolean(option))
      : undefined;
    return [{
      id,
      type: normalizeInputType(entry.type ?? entry.kind),
      ...(nonEmptyString(entry.label) ? { label: nonEmptyString(entry.label) } : {}),
      ...(nonEmptyString(entry.description) ? { description: nonEmptyString(entry.description) } : {}),
      ...(typeof entry.required === 'boolean' ? { required: entry.required } : {}),
      ...(toJsonValue(entry.default ?? entry.defaultValue) !== undefined
        ? { default: toJsonValue(entry.default ?? entry.defaultValue) }
        : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(nonEmptyString(entry.componentParam) ? { componentParam: nonEmptyString(entry.componentParam) } : {}),
    }];
  });
  return inputs.length > 0 ? inputs : undefined;
};

const normalizeDependencies = (value: unknown): ElementManifestRuntimeDependency[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const dependencies = value.flatMap((entry): ElementManifestRuntimeDependency[] => {
    if (typeof entry === 'string') {
      const name = nonEmptyString(entry);
      return name ? [{ name }] : [];
    }
    if (!isRecord(entry)) return [];
    const name = firstString(entry.name, entry.id, entry.package);
    if (!name) return [];
    return [{
      name,
      ...(nonEmptyString(entry.version) ? { version: nonEmptyString(entry.version) } : {}),
      ...(nonEmptyString(entry.runtime) ? { runtime: nonEmptyString(entry.runtime) } : {}),
      ...(typeof entry.optional === 'boolean' ? { optional: entry.optional } : {}),
    }];
  });
  return dependencies.length > 0 ? dependencies : undefined;
};

const normalizeAssetSlots = (value: unknown): ElementManifestAssetSlotBlock[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const slots = value.flatMap((entry): ElementManifestAssetSlotBlock[] => {
    if (!isRecord(entry)) return [];
    const id = nonEmptyString(entry.id);
    const label = nonEmptyString(entry.label) ?? id;
    const mediaType = entry.mediaType === 'video' ? 'video' : 'image';
    if (!id || !label) return [];
    return [{
      id,
      label,
      mediaType,
      required: typeof entry.required === 'boolean' ? entry.required : false,
      minItems: typeof entry.minItems === 'number' && Number.isFinite(entry.minItems) ? entry.minItems : 0,
      maxItems: typeof entry.maxItems === 'number' && Number.isFinite(entry.maxItems) ? entry.maxItems : 1,
      ...(nonEmptyString(entry.description) ? { description: nonEmptyString(entry.description) } : {}),
    }];
  });
  return slots.length > 0 ? slots : undefined;
};

const pickDescription = (metadata: Record<string, unknown> | undefined, manifest: ElementManifestJsonObject): string | undefined => {
  const descriptions = metadata?.descriptions ?? manifest.descriptions;
  if (isRecord(descriptions)) {
    return firstString(descriptions.short, descriptions.description, descriptions.long);
  }
  return firstString(metadata?.description, manifest.description, descriptions);
};

export const sequenceComponentMetadataToElementManifest: SequenceComponentMetadataToElementManifest = (
  metadata,
  options = {},
) => {
  const nested = metadata.elementManifest;
  const clipType = metadata.clipType;
  const themeId = metadata.themeId;
  const id = options.id ?? nested?.id ?? `reigh:sequence-component:${slugify(clipType || metadata.slug || metadata.name)}`;
  const aliases = uniqueStrings([
    ...(nested?.compatibility.aliases ?? []),
    clipType,
    clipType && !clipType.startsWith('custom:') ? `custom:${clipType}` : undefined,
  ]);

  return {
    version: '1',
    id,
    kind: {
      ...(nested?.kind ?? {}),
      source: 'reigh',
      type: 'sequence-component',
      namespace: nested?.kind.namespace ?? 'reigh',
      label: nested?.kind.label ?? metadata.name,
    },
    runtime: {
      ...(nested?.runtime ?? { renderer: 'react-sequence-component' }),
      renderer: 'react-sequence-component',
      source: options.resourceId ? 'database' : (nested?.runtime.source ?? 'inline-code'),
      code: metadata.code,
      clipType,
      themeId,
    },
    contract: {
      ...(nested?.contract ?? {}),
      schema: toJsonObject(metadata.schemaJson),
      defaults: toJsonObject(metadata.defaultsJson),
      ...(metadata.controlsManifest ? { controlsManifest: toJsonObjectArray(metadata.controlsManifest) ?? [] } : {}),
      ...(metadata.assetSlots ? { assetSlots: normalizeAssetSlots(metadata.assetSlots) ?? [] } : {}),
    },
    catalog: {
      ...(nested?.catalog ?? { name: metadata.name }),
      name: metadata.name,
      slug: metadata.slug,
      description: metadata.description,
    },
    provenance: {
      ...(nested?.provenance ?? { source: 'reigh' }),
      source: 'reigh',
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      resourceType: options.resourceType ?? nested?.provenance.resourceType ?? 'sequence-component',
      ...(options.userId ? { createdBy: { ...nested?.provenance.createdBy, userId: options.userId } } : {}),
      ...(metadata.created_by
        ? {
          createdBy: {
            ...nested?.provenance.createdBy,
            isYou: metadata.created_by.is_you,
            username: metadata.created_by.username,
            ...(options.userId ? { userId: options.userId } : {}),
          },
        }
        : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
      ...(options.generatedBy ? { generatedBy: options.generatedBy } : {}),
    },
    compatibility: {
      ...(nested?.compatibility ?? {}),
      aliases,
      reigh: {
        ...(nested?.compatibility.reigh ?? {}),
        clipType,
        themeId,
        controlsManifestAlias: 'controlsManifest',
        assetSlotsAlias: 'assetSlots',
        schemaAlias: 'schemaJson',
        defaultsAlias: 'defaultsJson',
      },
    },
  };
};

export const elementManifestToSequenceComponentMetadata: ElementManifestToSequenceComponentMetadata = (
  manifest,
  existingMetadata = {},
) => {
  const clipType = existingMetadata.clipType
    ?? manifest.compatibility.reigh?.clipType
    ?? manifest.runtime.clipType
    ?? '';
  const themeId = existingMetadata.themeId
    ?? manifest.compatibility.reigh?.themeId
    ?? manifest.runtime.themeId
    ?? '';

  return {
    name: existingMetadata.name ?? manifest.catalog.name,
    slug: existingMetadata.slug ?? manifest.catalog.slug ?? slugify(manifest.catalog.name || manifest.id),
    code: existingMetadata.code ?? manifest.runtime.code ?? '',
    schemaJson: existingMetadata.schemaJson ?? manifest.contract.schema ?? {},
    defaultsJson: existingMetadata.defaultsJson ?? manifest.contract.defaults ?? {},
    ...(existingMetadata.controlsManifest
      ? { controlsManifest: existingMetadata.controlsManifest }
      : (manifest.contract.controlsManifest ? { controlsManifest: manifest.contract.controlsManifest } : {})),
    ...(existingMetadata.assetSlots
      ? { assetSlots: existingMetadata.assetSlots }
      : (manifest.contract.assetSlots ? { assetSlots: manifest.contract.assetSlots } : {})),
    clipType,
    themeId,
    description: existingMetadata.description ?? manifest.catalog.description ?? '',
    ...(existingMetadata.created_by
      ? { created_by: existingMetadata.created_by }
      : {
        created_by: {
          is_you: manifest.provenance.createdBy?.isYou ?? false,
          username: manifest.provenance.createdBy?.username,
        },
      }),
    is_public: existingMetadata.is_public ?? false,
    elementManifest: manifest,
  };
};

export const artAgentsElementManifestToElementManifest: ArtAgentsElementManifestToElementManifest = (
  artAgentsManifest,
  options = {},
) => {
  const metadata = readRecord(artAgentsManifest, 'metadata');
  const contract = readRecord(artAgentsManifest, 'contract');
  const runtime = readRecord(artAgentsManifest, 'runtime');
  const compatibility = readRecord(artAgentsManifest, 'compatibility');
  const compatibilityReigh = readRecord(compatibility, 'reigh');
  const rawId = firstString(artAgentsManifest.id, metadata?.id) ?? 'element';
  const kind = firstString(
    typeof artAgentsManifest.kind === 'string' ? artAgentsManifest.kind : undefined,
    readString(artAgentsManifest.kind, 'type'),
    metadata?.kind,
    'element',
  ) ?? 'element';
  const packId = options.packId
    ?? firstString(artAgentsManifest.pack_id, artAgentsManifest.packId, metadata?.pack_id, metadata?.packId);
  const reighClipType = firstString(
    artAgentsManifest.clipType,
    artAgentsManifest.reigh_clip_type,
    runtime?.clipType,
    compatibilityReigh?.clipType,
  );
  const schema = toJsonObject(contract?.schema ?? artAgentsManifest.schema);
  const defaults = toJsonObject(contract?.defaults ?? artAgentsManifest.defaults);
  const dependencies = normalizeDependencies(runtime?.dependencies ?? artAgentsManifest.dependencies);
  const alias = `artagents:${kind}:${rawId}`;

  return {
    version: '1',
    id: options.idPrefix ? `${options.idPrefix}:${rawId}` : rawId,
    kind: {
      source: 'artagents',
      type: kind,
      ...(packId ? { namespace: packId } : {}),
      ...(firstString(metadata?.label, artAgentsManifest.label, artAgentsManifest.name) ? {
        label: firstString(metadata?.label, artAgentsManifest.label, artAgentsManifest.name),
      } : {}),
    },
    runtime: {
      renderer: 'artagents-element',
      source: options.filePath ? 'file' : 'package',
      ...(firstString(runtime?.modulePath, runtime?.path, artAgentsManifest.modulePath, artAgentsManifest.path)
        ? { modulePath: firstString(runtime?.modulePath, runtime?.path, artAgentsManifest.modulePath, artAgentsManifest.path) }
        : {}),
      ...(firstString(runtime?.exportName, runtime?.export, artAgentsManifest.exportName)
        ? { exportName: firstString(runtime?.exportName, runtime?.export, artAgentsManifest.exportName) }
        : {}),
      ...(reighClipType ? { clipType: reighClipType } : {}),
      ...(dependencies ? { dependencies } : {}),
    },
    contract: {
      schema,
      defaults,
      ...(normalizeInputs(contract?.inputs ?? artAgentsManifest.inputs) ? {
        inputs: normalizeInputs(contract?.inputs ?? artAgentsManifest.inputs),
      } : {}),
      ...(toJsonObjectArray(contract?.controlsManifest ?? artAgentsManifest.controlsManifest) ? {
        controlsManifest: toJsonObjectArray(contract?.controlsManifest ?? artAgentsManifest.controlsManifest),
      } : {}),
      ...(normalizeAssetSlots(contract?.assetSlots ?? artAgentsManifest.assetSlots) ? {
        assetSlots: normalizeAssetSlots(contract?.assetSlots ?? artAgentsManifest.assetSlots),
      } : {}),
    },
    catalog: {
      name: firstString(metadata?.name, artAgentsManifest.name, artAgentsManifest.title, rawId) ?? rawId,
      slug: slugify(firstString(metadata?.slug, artAgentsManifest.slug, rawId) ?? rawId),
      ...(pickDescription(metadata, artAgentsManifest) ? { description: pickDescription(metadata, artAgentsManifest) } : {}),
      ...(toStringArray(metadata?.keywords ?? artAgentsManifest.keywords) ? {
        keywords: toStringArray(metadata?.keywords ?? artAgentsManifest.keywords),
      } : {}),
      ...(toStringArray(metadata?.tags ?? artAgentsManifest.tags) ? {
        tags: toStringArray(metadata?.tags ?? artAgentsManifest.tags),
      } : {}),
      ...(packId ? { packId } : {}),
      ...(firstString(metadata?.category, artAgentsManifest.category) ? {
        category: firstString(metadata?.category, artAgentsManifest.category),
      } : {}),
    },
    provenance: {
      source: 'artagents',
      ...(packId ? { packId } : {}),
      ...(options.filePath ? { filePath: options.filePath } : {}),
      importId: rawId,
    },
    compatibility: {
      aliases: uniqueStrings([
        ...(
          Array.isArray(compatibility?.aliases)
            ? compatibility.aliases.map(nonEmptyString)
            : []
        ),
        alias,
        reighClipType,
      ]),
      ...(reighClipType
        ? { reigh: { clipType: reighClipType } }
        : {}),
      artAgents: {
        id: rawId,
        kind,
        ...(packId ? { packId } : {}),
        ...(firstString(runtime?.type, runtime?.name) ? { runtime: firstString(runtime?.type, runtime?.name) } : {}),
      },
    },
  };
};
