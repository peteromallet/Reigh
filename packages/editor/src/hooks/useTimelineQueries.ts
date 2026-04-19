import { useEffect, useState } from 'react';
import type { TimelineSummary } from '../data/DataProvider.js';
import { useEditorStore } from './timelineStore.js';

export function useTimelineQueries() {
  const ports = useEditorStore((state) => state.ports);
  const [timelines, setTimelines] = useState<TimelineSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!ports.dataProvider.listTimelines) {
      setTimelines([]);
      return;
    }

    void ports.dataProvider.listTimelines().then((next) => {
      if (!cancelled) {
        setTimelines(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [ports.dataProvider]);

  return { timelines };
}
