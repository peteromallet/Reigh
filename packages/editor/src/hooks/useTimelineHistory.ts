import { useCallback, useEffect, useState } from 'react';
import type { TimelineCheckpoint } from '../data/DataProvider.js';
import { useEditorStore } from './timelineStore.js';

export function useTimelineHistory() {
  const document = useEditorStore((state) => state.document);
  const ports = useEditorStore((state) => state.ports);
  const [checkpoints, setCheckpoints] = useState<TimelineCheckpoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!document || !ports.dataProvider.loadCheckpoints) {
      setCheckpoints([]);
      return;
    }

    void ports.dataProvider.loadCheckpoints(document.timelineId).then((next) => {
      if (!cancelled) {
        setCheckpoints(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [document, ports.dataProvider]);

  const saveCheckpoint = useCallback(async (label: string) => {
    if (!document || !ports.dataProvider.saveCheckpoint) {
      return null;
    }

    const id = await ports.dataProvider.saveCheckpoint(document.timelineId, {
      timelineId: document.timelineId,
      config: document.config,
      createdAt: new Date().toISOString(),
      triggerType: 'manual',
      label,
      editsSinceLastCheckpoint: 0,
    });
    const next = await ports.dataProvider.loadCheckpoints?.(document.timelineId);
    if (next) {
      setCheckpoints(next);
    }
    return id;
  }, [document, ports.dataProvider]);

  return { checkpoints, saveCheckpoint };
}
