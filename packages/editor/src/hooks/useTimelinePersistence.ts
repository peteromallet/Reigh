import { useCallback } from 'react';
import { useEditorStore } from './timelineStore.js';

export function useTimelinePersistence() {
  const document = useEditorStore((state) => state.document);
  const ports = useEditorStore((state) => state.ports);
  const setDocument = useEditorStore((state) => state.setDocument);

  const save = useCallback(async () => {
    if (!document) {
      throw new Error('No document loaded');
    }

    const nextVersion = await ports.dataProvider.saveTimeline(
      document.timelineId,
      document.config,
      document.configVersion,
      document.registry,
    );

    setDocument({
      ...document,
      configVersion: nextVersion,
    });
    return nextVersion;
  }, [document, ports.dataProvider, setDocument]);

  return { save };
}
