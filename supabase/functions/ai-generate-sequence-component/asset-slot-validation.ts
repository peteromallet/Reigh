export const ASSET_SLOT_BINDINGS_PARAM = 'assetSlotBindings' as const;
export const ASSET_SLOTS_PARAM = 'assetSlots' as const;

export const GENERATED_SEQUENCE_LOOSE_MEDIA_PARAM_KEYS = [
  'imageAssetKeys',
  'videoAssetKeys',
  'images',
  'videos',
] as const;

export type AssetSlotMediaType = 'image' | 'video';

export interface AssetSlotDefinition {
  id: string;
  label: string;
  mediaType: AssetSlotMediaType;
  required: boolean;
  minItems: number;
  maxItems: number;
}

export interface AssetSlotValidationAsset {
  key: string;
  mediaType: AssetSlotMediaType;
}

const ASSET_SLOT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const trimString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeMediaType = (value: unknown): AssetSlotMediaType | null => {
  const raw = trimString(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === 'image' || raw.startsWith('image/')) return 'image';
  if (raw === 'video' || raw.startsWith('video/')) return 'video';
  return null;
};

const readNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
};

export function hasLooseGeneratedMediaParamName(key: string): boolean {
  return (GENERATED_SEQUENCE_LOOSE_MEDIA_PARAM_KEYS as readonly string[]).includes(key);
}

export function collectLooseGeneratedMediaParamPaths(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .filter(hasLooseGeneratedMediaParamName)
    .map((key) => `${path}.${key}`);
}

export function normalizeAssetSlots(value: unknown): { slots: AssetSlotDefinition[]; errors: string[] } {
  if (!Array.isArray(value)) {
    return { slots: [], errors: ['ASSET_SLOTS must be a JSON array'] };
  }

  const slots: AssetSlotDefinition[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();

  value.forEach((slot, index) => {
    const slotPath = `ASSET_SLOTS[${index}]`;
    if (!isRecord(slot)) {
      errors.push(`${slotPath} must be an object`);
      return;
    }

    const id = trimString(slot.id);
    if (!id || !ASSET_SLOT_ID_PATTERN.test(id)) {
      errors.push(`${slotPath}.id must start with a letter and contain only letters, numbers, underscores, or hyphens`);
      return;
    }
    if (seenIds.has(id)) {
      errors.push(`ASSET_SLOTS duplicate slot id "${id}"`);
      return;
    }

    const mediaType = normalizeMediaType(slot.mediaType);
    if (!mediaType) {
      errors.push(`${slotPath}.mediaType must be "image" or "video"`);
      return;
    }

    const required = typeof slot.required === 'boolean' ? slot.required : false;
    const minItems = readNonNegativeInteger(slot.minItems) ?? (required ? 1 : 0);
    const maxItems = readNonNegativeInteger(slot.maxItems) ?? 1;
    if (maxItems < 1 || minItems > maxItems) {
      errors.push(`${slotPath} cardinality must satisfy maxItems >= 1 and minItems <= maxItems`);
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
    });
  });

  return { slots, errors };
}

export function normalizeAssetSlotBindings(value: unknown): { bindings: Record<string, string[]>; errors: string[] } {
  if (value === undefined || value === null) {
    return { bindings: {}, errors: [] };
  }
  if (!isRecord(value)) {
    return { bindings: {}, errors: [`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM} must be an object keyed by slot id`] };
  }

  const bindings: Record<string, string[]> = {};
  const errors: string[] = [];
  for (const [slotId, rawBinding] of Object.entries(value)) {
    if (!Array.isArray(rawBinding)) {
      errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId} must be an array of asset keys`);
      continue;
    }
    const keys: string[] = [];
    rawBinding.forEach((assetKey, index) => {
      const normalized = trimString(assetKey);
      if (!normalized) {
        errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId}[${index}] must be a non-empty asset key string`);
        return;
      }
      keys.push(normalized);
    });
    bindings[slotId] = keys;
  }
  return { bindings, errors };
}

export function validateAssetSlotBindings(input: {
  slots: readonly AssetSlotDefinition[];
  bindings: unknown;
  allowedAssets: readonly AssetSlotValidationAsset[];
}): string[] {
  const { slots, allowedAssets } = input;
  const normalized = normalizeAssetSlotBindings(input.bindings);
  const errors = [...normalized.errors];
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const assetByKey = new Map(allowedAssets.map((asset) => [asset.key, asset]));

  for (const [slotId, keys] of Object.entries(normalized.bindings)) {
    const slot = slotById.get(slotId);
    if (!slot) {
      errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId} references unknown asset slot "${slotId}"`);
      continue;
    }

    const seenKeys = new Set<string>();
    for (const key of keys) {
      if (seenKeys.has(key)) {
        errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId} duplicates asset key "${key}"`);
      }
      seenKeys.add(key);

      const asset = assetByKey.get(key);
      if (!asset) {
        errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId} references unknown asset key "${key}"`);
        continue;
      }
      if (asset.mediaType !== slot.mediaType) {
        errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId} asset "${key}" is ${asset.mediaType}, but slot requires ${slot.mediaType}`);
      }
    }

    if (keys.length < slot.minItems) {
      errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId} requires at least ${slot.minItems} asset(s)`);
    }
    if (keys.length > slot.maxItems) {
      errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slotId} allows at most ${slot.maxItems} asset(s)`);
    }
  }

  for (const slot of slots) {
    if (Object.prototype.hasOwnProperty.call(normalized.bindings, slot.id)) continue;
    if (!slot.required && slot.minItems === 0) continue;
    errors.push(`DEFAULTS.${ASSET_SLOT_BINDINGS_PARAM}.${slot.id} requires at least ${slot.minItems} asset(s)`);
  }

  return errors;
}
