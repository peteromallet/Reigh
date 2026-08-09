// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShotGroupLabels, type PositionedShotGroup } from './ShotGroupOverlay';
import {
  ACTION_ID_ATTR,
  SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR,
  SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR,
  SHOT_GROUP_LABEL_ACTION_ID,
} from '@/tools/video-editor/lib/timeline-dom';

const positionedShotGroups: PositionedShotGroup[] = [{
  key: 'shot-1:V1',
  shotId: 'shot-1',
  shotName: 'Shot 1',
  clipIds: ['clip-1', 'clip-2'],
  start: 0,
  end: 4,
  rowId: 'V1',
  color: '#00a3ff',
  hasFinalVideo: false,
  hasStaleVideo: false,
  hasActiveTask: false,
  left: 10,
  top: 20,
  width: 120,
  height: 30,
}];

describe('ShotGroupLabels', () => {
  it('carries the drag-anchor attributes the clip drag machine resolves', () => {
    const { getByTitle } = render(
      <ShotGroupLabels
        positionedShotGroups={positionedShotGroups}
        hidden={false}
        showTouchActions={false}
        scrollLeft={0}
        scrollTop={0}
        openShotGroupMenu={vi.fn()}
      />,
    );
    const label = getByTitle('Shot 1');

    expect(label.getAttribute(ACTION_ID_ATTR)).toBe(SHOT_GROUP_LABEL_ACTION_ID);
    expect(label.getAttribute(SHOT_GROUP_DRAG_ANCHOR_CLIP_ID_ATTR)).toBe('clip-1');
    expect(label.getAttribute(SHOT_GROUP_DRAG_ANCHOR_ROW_ID_ATTR)).toBe('V1');
  });

  it('lets pointerdown bubble so label drags reach the shared drag listener', () => {
    const parentPointerDown = vi.fn();
    const { getByTitle } = render(
      <div onPointerDown={parentPointerDown}>
        <ShotGroupLabels
          positionedShotGroups={positionedShotGroups}
          hidden={false}
          showTouchActions={false}
          scrollLeft={0}
          scrollTop={0}
          openShotGroupMenu={vi.fn()}
        />
      </div>,
    );

    fireEvent.pointerDown(getByTitle('Shot 1'));

    expect(parentPointerDown).toHaveBeenCalledTimes(1);
  });

  it('still stops click, double-click, and context-menu propagation on the label', () => {
    const parentClick = vi.fn();
    const parentDoubleClick = vi.fn();
    const parentContextMenu = vi.fn();
    const onSelectClips = vi.fn();
    const onShotGroupNavigate = vi.fn();
    const openShotGroupMenu = vi.fn();
    const { getByTitle } = render(
      <div onClick={parentClick} onDoubleClick={parentDoubleClick} onContextMenu={parentContextMenu}>
        <ShotGroupLabels
          positionedShotGroups={positionedShotGroups}
          hidden={false}
          showTouchActions={false}
          scrollLeft={0}
          scrollTop={0}
          openShotGroupMenu={openShotGroupMenu}
          onSelectClips={onSelectClips}
          onShotGroupNavigate={onShotGroupNavigate}
        />
      </div>,
    );
    const label = getByTitle('Shot 1');

    fireEvent.click(label);
    fireEvent.doubleClick(label);
    fireEvent.contextMenu(label);

    expect(onSelectClips).toHaveBeenCalledWith(['clip-1', 'clip-2']);
    expect(onShotGroupNavigate).toHaveBeenCalledWith('shot-1');
    expect(openShotGroupMenu).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentDoubleClick).not.toHaveBeenCalled();
    expect(parentContextMenu).not.toHaveBeenCalled();
  });
});
