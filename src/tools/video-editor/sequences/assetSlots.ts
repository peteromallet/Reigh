export const ASSET_SLOT_BINDINGS_PARAM = 'assetSlotBindings' as const;
export const ASSET_SLOTS_PARAM = 'assetSlots' as const;

export const GENERATED_SEQUENCE_LOOSE_MEDIA_PARAM_KEYS = [
  'imageAssetKeys',
  'videoAssetKeys',
  'images',
  'videos',
] as const;

export type GeneratedSequenceLooseMediaParamKey = (
  typeof GENERATED_SEQUENCE_LOOSE_MEDIA_PARAM_KEYS
)[number];

export type AssetSlotMediaType = 'image' | 'video';

export type AssetSlotDefinition = {
  id: string;
  label: string;
  mediaType: AssetSlotMediaType;
  required: boolean;
  minItems: number;
  maxItems: number;
  description?: string;
};

export type AssetSlotBindings = Record<string, string[]>;

export type MaterializedAssetSlots = Record<string, string[]>;

export type AssetSlotResolvableAsset = {
  key?: string;
  url?: string;
  src?: string;
  file?: string;
  mediaType?: unknown;
  type?: unknown;
};

export type AssetSlotAssetRegistry = Record<string, AssetSlotResolvableAsset | undefined>;

export type AssetSlotValidationErrorCode =
  | 'invalid_asset_slot_list'
  | 'invalid_asset_slot'
  | 'invalid_slot_id'
  | 'duplicate_slot_id'
  | 'invalid_media_type'
  | 'invalid_cardinality'
  | 'invalid_slot_binding_list'
  | 'invalid_slot_binding'
  | 'unknown_slot'
  | 'duplicate_asset_binding'
  | 'missing_required_slot'
  | 'too_few_assets'
  | 'too_many_assets'
  | 'unknown_asset_key'
  | 'media_type_mismatch'
  | 'missing_asset_url'
  | 'loose_generated_media_param';

export type AssetSlotValidationError = {
  code: AssetSlotValidationErrorCode;
  path: string;
  message: string;
  slotId?: string;
  assetKey?: string;
  expected?: unknown;
  actual?: unknown;
};

export type NormalizeAssetSlotsResult = {
  slots: AssetSlotDefinition[];
  errors: AssetSlotValidationError[];
};

export type NormalizeAssetSlotBindingsResult = {
  bindings: AssetSlotBindings;
  errors: AssetSlotValidationError[];
};

export type ValidateAssetSlotBindingsOptions = {
  slots: readonly AssetSlotDefinition[];
  bindings: AssetSlotBindings | unknown;
  registry?: AssetSlotAssetRegistry;
  path?: string;
};

export type ValidateAssetSlotBindingsResult = {
  bindings: AssetSlotBindings;
  errors: AssetSlotValidationError[];
};

export type MaterializeAssetSlotsOptions = {
  slots: readonly AssetSlotDefinition[];
  bindings: AssetSlotBindings | unknown;
  registry: AssetSlotAssetRegistry;
  path?: string;
};

export type MaterializeAssetSlotsResult = {
  assetSlots: MaterializedAssetSlots;
  errors: AssetSlotValidationError[];
};

const ASSET_SLOT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const trimString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
};

const normalizeMediaType = (value: unknown): AssetSlotMediaType | null => {
  const raw = trimString(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === 'image' || raw.startsWith('image/')) return 'image';
  if (raw === 'video' || raw.startsWith('video/')) return 'video';
  return null;
};

const inferMediaTypeFromUrl = (url: string): AssetSlotMediaType | null => {
  const normalized = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/.test(normalized)) return 'image';
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(normalized)) return 'video';
  return null;
};

export const inferAssetSlotMediaType = (
  value: unknown,
): AssetSlotMediaType | null => {
  if (typeof value === 'string') {
    return normalizeMediaType(value) ?? inferMediaTypeFromUrl(value);
  }
  if (!isRecord(value)) return null;
  return normalizeMediaType(value.type)
    ?? normalizeMediaType(value.mediaType)
    ?? (typeof value.src === 'string' ? inferMediaTypeFromUrl(value.src) : null)
    ?? (typeof value.file === 'string' ? inferMediaTypeFromUrl(value.file) : null)
    ?? (typeof value.url === 'string' ? inferMediaTypeFromUrl(value.url) : null);
};

export const resolveAssetSlotUrl = (
  assetKey: string,
  registry: AssetSlotAssetRegistry,
): string | null => {
  const entry = registry[assetKey];
  if (!entry) return null;
  return trimString(entry.url) ?? trimString(entry.src) ?? trimString(entry.file);
};

const assetSlotError = (
  error: AssetSlotValidationError,
): AssetSlotValidationError => error;

export const normalizeAssetSlots = (
  value: unknown,
  path = 'assetSlots',
): NormalizeAssetSlotsResult => {
  if (!Array.isArray(value)) {
    return {
      slots: [],
      errors: [assetSlotError({
        code: 'invalid_asset_slot_list',
        path,
        message: 'assetSlots must be an array.',
        actual: value,
      })],
    };
  }

  const errors: AssetSlotValidationError[] = [];
  const slots: AssetSlotDefinition[] = [];
  const seenIds = new Set<string>();

  value.forEach((slot, index) => {
    const slotPath = `${path}[${index}]`;
    if (!isRecord(slot)) {
      errors.push({
        code: 'invalid_asset_slot',
        path: slotPath,
        message: 'Asset slot must be an object.',
        actual: slot,
      });
      return;
    }

    const id = trimString(slot.id);
    if (!id || !ASSET_SLOT_ID_PATTERN.test(id)) {
      errors.push({
        code: 'invalid_slot_id',
        path: `${slotPath}.id`,
        message: 'Asset slot id must start with a letter and contain only letters, numbers, underscores, or hyphens.',
        actual: slot.id,
      });
      return;
    }

    if (seenIds.has(id)) {
      errors.push({
        code: 'duplicate_slot_id',
        path: `${slotPath}.id`,
        message: `Asset slot id "${id}" is duplicated.`,
        slotId: id,
      });
      return;
    }

    const mediaType = normalizeMediaType(slot.mediaType);
    if (!mediaType) {
      errors.push({
        code: 'invalid_media_type',
        path: `${slotPath}.mediaType`,
        message: 'Asset slot mediaType must be "image" or "video".',
        slotId: id,
        actual: slot.mediaType,
      });
      return;
    }

    const required = typeof slot.required === 'boolean' ? slot.required : false;
    const minItems = readNonNegativeInteger(slot.minItems) ?? (required ? 1 : 0);
    const maxItems = readNonNegativeInteger(slot.maxItems) ?? 1;
    if (maxItems < 1 || minItems > maxItems) {
      errors.push({
        code: 'invalid_cardinality',
        path: slotPath,
        message: 'Asset slot cardinality must satisfy maxItems >= 1 and minItems <= maxItems.',
        slotId: id,
        expected: { minItems: '<= maxItems', maxItems: '>= 1' },
        actual: { minItems: slot.minItems, maxItems: slot.maxItems },
      });
      return;
    }

    seenIds.add(id);
    slots.push({
      id,
      label: trimString(slot.label) ?? id,
      mediaType,
      required,
      minItems,
      maxItems,
      ...(trimString(slot.description) ? { description: trimString(slot.description) as string } : {}),
    });
  });

  return { slots, errors };
};

export const normalizeAssetSlotBindings = (
  value: unknown,
  path = ASSET_SLOT_BINDINGS_PARAM,
): NormalizeAssetSlotBindingsResult => {
  if (value === undefined || value === null) {
    return { bindings: {}, errors: [] };
  }
  if (!isRecord(value)) {
    return {
      bindings: {},
      errors: [{
        code: 'invalid_slot_binding_list',
        path,
        message: 'assetSlotBindings must be an object keyed by slot id.',
        actual: value,
      }],
    };
  }

  const bindings: AssetSlotBindings = {};
  const errors: AssetSlotValidationError[] = [];

  for (const [slotId, rawBinding] of Object.entries(value)) {
    const bindingPath = `${path}.${slotId}`;
    if (!Array.isArray(rawBinding)) {
      errors.push({
        code: 'invalid_slot_binding',
        path: bindingPath,
        message: 'Asset slot binding must be an array of asset keys.',
        slotId,
        actual: rawBinding,
      });
      continue;
    }

    const assetKeys: string[] = [];
    rawBinding.forEach((assetKey, index) => {
      const normalizedKey = trimString(assetKey);
      if (!normalizedKey) {
        errors.push({
          code: 'invalid_slot_binding',
          path: `${bindingPath}[${index}]`,
          message: 'Asset slot binding entries must be non-empty asset key strings.',
          slotId,
          actual: assetKey,
        });
        return;
      }
      assetKeys.push(normalizedKey);
    });
    bindings[slotId] = assetKeys;
  }

  return { bindings, errors };
};

export const validateAssetSlotBindings = (
  options: ValidateAssetSlotBindingsOptions,
): ValidateAssetSlotBindingsResult => {
  const { slots, registry, path = ASSET_SLOT_BINDINGS_PARAM } = options;
  const normalized = normalizeAssetSlotBindings(options.bindings, path);
  const errors = [...normalized.errors];
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  for (const slotId of Object.keys(normalized.bindings)) {
    const slot = slotById.get(slotId);
    if (!slot) {
      errors.push({
        code: 'unknown_slot',
        path: `${path}.${slotId}`,
        message: `Unknown asset slot "${slotId}".`,
        slotId,
      });
      continue;
    }

    const assetKeys = normalized.bindings[slotId] ?? [];
    const seenAssetKeys = new Set<string>();
    for (const assetKey of assetKeys) {
      if (seenAssetKeys.has(assetKey)) {
        errors.push({
          code: 'duplicate_asset_binding',
          path: `${path}.${slotId}`,
          message: `Asset key "${assetKey}" is duplicated in slot "${slotId}".`,
          slotId,
          assetKey,
        });
      }
      seenAssetKeys.add(assetKey);

      if (!registry) continue;
      const asset = registry[assetKey];
      if (!asset) {
        errors.push({
          code: 'unknown_asset_key',
          path: `${path}.${slotId}`,
          message: `Asset key "${assetKey}" is not available.`,
          slotId,
          assetKey,
        });
        continue;
      }
      const actualMediaType = inferAssetSlotMediaType(asset);
      if (actualMediaType && actualMediaType !== slot.mediaType) {
        errors.push({
          code: 'media_type_mismatch',
          path: `${path}.${slotId}`,
          message: `Asset key "${assetKey}" is ${actualMediaType}, but slot "${slotId}" requires ${slot.mediaType}.`,
          slotId,
          assetKey,
          expected: slot.mediaType,
          actual: actualMediaType,
        });
      }
    }

    if (assetKeys.length < slot.minItems) {
      errors.push({
        code: assetKeys.length === 0 && slot.required ? 'missing_required_slot' : 'too_few_assets',
        path: `${path}.${slotId}`,
        message: `Slot "${slotId}" requires at least ${slot.minItems} asset(s).`,
        slotId,
        expected: slot.minItems,
        actual: assetKeys.length,
      });
    }
    if (assetKeys.length > slot.maxItems) {
      errors.push({
        code: 'too_many_assets',
        path: `${path}.${slotId}`,
        message: `Slot "${slotId}" allows at most ${slot.maxItems} asset(s).`,
        slotId,
        expected: slot.maxItems,
        actual: assetKeys.length,
      });
    }
  }

  for (const slot of slots) {
    if (Object.prototype.hasOwnProperty.call(normalized.bindings, slot.id)) continue;
    if (!slot.required && slot.minItems === 0) continue;
    errors.push({
      code: 'missing_required_slot',
      path: `${path}.${slot.id}`,
      message: `Slot "${slot.id}" requires at least ${slot.minItems} asset(s).`,
      slotId: slot.id,
      expected: slot.minItems,
      actual: 0,
    });
  }

  return {
    bindings: normalized.bindings,
    errors,
  };
};

export const materializeAssetSlots = (
  options: MaterializeAssetSlotsOptions,
): MaterializeAssetSlotsResult => {
  const { slots, registry, path = ASSET_SLOT_BINDINGS_PARAM } = options;
  const validation = validateAssetSlotBindings({
    slots,
    bindings: options.bindings,
    registry,
    path,
  });
  const errors = [...validation.errors];
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const assetSlots: MaterializedAssetSlots = {};

  for (const [slotId, assetKeys] of Object.entries(validation.bindings)) {
    const slot = slotById.get(slotId);
    if (!slot) continue;

    const urls: string[] = [];
    for (const assetKey of assetKeys) {
      const asset = registry[assetKey];
      if (!asset) continue;
      const mediaType = inferAssetSlotMediaType(asset);
      if (mediaType && mediaType !== slot.mediaType) continue;
      const url = resolveAssetSlotUrl(assetKey, registry);
      if (!url) {
        errors.push({
          code: 'missing_asset_url',
          path: `${path}.${slotId}`,
          message: `Asset key "${assetKey}" has no URL to inject.`,
          slotId,
          assetKey,
        });
        continue;
      }
      urls.push(url);
    }

    assetSlots[slotId] = urls;
  }

  return { assetSlots, errors };
};

export const hasLooseGeneratedMediaParamName = (
  key: string,
): key is GeneratedSequenceLooseMediaParamKey => (
  (GENERATED_SEQUENCE_LOOSE_MEDIA_PARAM_KEYS as readonly string[]).includes(key)
);

export const collectLooseGeneratedMediaParamErrors = (
  value: unknown,
  path = 'params',
): AssetSlotValidationError[] => {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .filter(hasLooseGeneratedMediaParamName)
    .map((key) => ({
      code: 'loose_generated_media_param',
      path: `${path}.${key}`,
      message: `Generated sequence components must use ${ASSET_SLOT_BINDINGS_PARAM} for persisted asset keys and host-injected ${ASSET_SLOTS_PARAM} for URLs, not "${key}".`,
      actual: key,
    }));
};

