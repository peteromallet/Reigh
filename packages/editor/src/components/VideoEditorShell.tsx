import { useMemo } from 'react';
import { useEditorStore } from '../hooks/timelineStore.js';
import { TimelineCanvas } from './TimelineCanvas.js';
import { RemotionPreview } from './PreviewPanel/RemotionPreview.js';

export function TimelineEditorShell() {
  const data = useEditorStore((state) => state.data);
  const loading = useEditorStore((state) => state.loading);
  const error = useEditorStore((state) => state.error);
  const currentTime = useEditorStore((state) => state.currentTime);
  const setCurrentTime = useEditorStore((state) => state.setCurrentTime);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);

  const selectedClip = useMemo(() => {
    if (!data || selectedClipIds.length !== 1) {
      return null;
    }
    return data.config.clips.find((clip) => clip.id === selectedClipIds[0]) ?? null;
  }, [data, selectedClipIds]);

  if (loading) {
    return <div>Loading timeline…</div>;
  }

  if (error) {
    return <div role="alert">{error}</div>;
  }

  if (!data) {
    return <div>No document loaded.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16 }}>
      <div style={{ display: 'grid', gap: 16 }}>
        <RemotionPreview
          config={data.resolvedConfig}
          currentTime={currentTime}
          onTimeUpdate={setCurrentTime}
        />
        <TimelineCanvas />
      </div>
      <aside style={{ border: '1px solid #d4d4d8', borderRadius: 8, padding: 16 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Inspector</h2>
        {selectedClip ? (
          <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
            <div>
              <dt style={{ fontWeight: 600 }}>Clip</dt>
              <dd style={{ margin: 0 }}>{selectedClip.id}</dd>
            </div>
            <div>
              <dt style={{ fontWeight: 600 }}>Track</dt>
              <dd style={{ margin: 0 }}>{selectedClip.track}</dd>
            </div>
            <div>
              <dt style={{ fontWeight: 600 }}>Asset</dt>
              <dd style={{ margin: 0 }}>{selectedClip.asset ?? 'none'}</dd>
            </div>
          </dl>
        ) : (
          <p style={{ margin: 0 }}>Select a clip to inspect it.</p>
        )}
      </aside>
    </div>
  );
}
