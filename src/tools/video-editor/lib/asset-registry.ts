import type { AssetRegistry, AssetRegistryEntry } from '@/tools/video-editor/types/index.ts';

type AssetEntryWithSource = Pick<AssetRegistryEntry, 'file' | 'media_id'> & {
  src?: string;
};

const normalizeReference = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Return the explicit managed-media identity, when one is present. */
export const getAssetMediaId = (entry: AssetEntryWithSource | null | undefined): string | undefined => (
  normalizeReference(entry?.media_id)
);

/** Return the legacy/source file locator, without interpreting it as identity. */
export const getAssetFileLocator = (entry: AssetEntryWithSource | null | undefined): string | undefined => (
  normalizeReference(entry?.file)
);

/**
 * Return the token used to resolve an asset. Managed identity is canonical;
 * the file locator is only a compatibility fallback when no identity exists.
 */
export const getAssetResolutionToken = (entry: AssetEntryWithSource | null | undefined): string | undefined => (
  getAssetMediaId(entry) ?? getAssetFileLocator(entry)
);

/** Return an already-resolved source, falling back to the canonical token. */
export const getAssetResolvedSource = (entry: AssetEntryWithSource | null | undefined): string | undefined => (
  normalizeReference(entry?.src) ?? getAssetResolutionToken(entry)
);

/** Return a stable user-facing reference without ever rendering an undefined value. */
export const getAssetDisplayReference = (
  entry: AssetEntryWithSource | null | undefined,
  fallback = 'Unnamed asset',
): string => (
  getAssetFileLocator(entry)
  ?? getAssetMediaId(entry)
  ?? normalizeReference(entry?.src)
  ?? normalizeReference(fallback)
  ?? 'Unnamed asset'
);

/** Build a total map of only entries with an explicit usable reference. */
export const buildAssetReferenceMap = (registry: AssetRegistry): Record<string, string> => (
  Object.fromEntries(
    Object.entries(registry.assets ?? {}).flatMap(([assetKey, entry]) => {
      const reference = getAssetResolutionToken(entry);
      return reference ? [[assetKey, reference] as const] : [];
    }),
  )
);

/** Reject ambiguous managed identities before they can reach a bridge route. */
export const validateAssetRegistryMediaIds = (registry: AssetRegistry): void => {
  const owners = new Map<string, string>();
  for (const assetKey of Object.keys(registry.assets ?? {}).sort()) {
    const mediaId = getAssetMediaId(registry.assets[assetKey]);
    if (!mediaId) continue;
    const priorAssetKey = owners.get(mediaId);
    if (priorAssetKey) {
      throw new Error(
        `Asset registry media_id '${mediaId}' is ambiguous between '${priorAssetKey}' and '${assetKey}'`,
      );
    }
    owners.set(mediaId, assetKey);
  }
};
