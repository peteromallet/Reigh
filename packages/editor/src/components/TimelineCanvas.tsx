import { getClipTimelineDuration } from '@tbd/engine';
import { useTimelineEditorData, useTimelineEditorOps } from '../hooks/timelineStore.js';

export interface TimelineCanvasProps {
  onSelectClip?: (clipId: string) => void;
}

export function TimelineCanvas({ onSelectClip }: TimelineCanvasProps) {
  const data = useTimelineEditorData();
  const ops = useTimelineEditorOps();

  if (!data.data) {
    return <div>No timeline loaded.</div>;
  }

  const timelineData = data.data;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {timelineData.tracks.map((track) => (
        <div key={track.id} style={{ border: '1px solid #d4d4d8', borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{track.label}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {timelineData.config.clips.filter((clip) => clip.track === track.id).map((clip) => {
              const selected = data.selectedClipIds.has(clip.id);
              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => {
                    ops.selectClip(clip.id);
                    onSelectClip?.(clip.id);
                  }}
                  style={{
                    borderRadius: 6,
                    border: selected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                    background: selected ? '#dbeafe' : '#fff',
                    padding: '8px 10px',
                    minWidth: 120,
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{clip.id}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    at {clip.at.toFixed(2)}s, {getClipTimelineDuration(clip).toFixed(2)}s
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
