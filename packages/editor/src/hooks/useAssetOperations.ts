import { useCallback } from 'react';
import type { AssetRegistryEntry } from '@tbd/engine';
import { useEditorStore } from './timelineStore.js';

export function useAssetOperations() {
  const document = useEditorStore((state) => state.document);
  const ports = useEditorStore((state) => state.ports);
  const setDocument = useEditorStore((state) => state.setDocument);

  const registerAsset = useCallback(async (assetId: string, entry: AssetRegistryEntry) => {
    if (!document || !ports.dataProvider.registerAsset) {
      throw new Error('Asset registration is unavailable');
    }

    await ports.dataProvider.registerAsset(document.timelineId, assetId, entry);
    setDocument({
      ...document,
      registry: {
        assets: {
          ...document.registry.assets,
          [assetId]: entry,
        },
      },
    });
  }, [document, ports.dataProvider, setDocument]);

  const uploadAsset = useCallback(async (file: File | Blob | Uint8Array) => {
    if (!document || !ports.dataProvider.uploadAsset) {
      throw new Error('Asset upload is unavailable');
    }

    return ports.dataProvider.uploadAsset(file, { timelineId: document.timelineId });
  }, [document, ports.dataProvider]);

  return { registerAsset, uploadAsset };
}
