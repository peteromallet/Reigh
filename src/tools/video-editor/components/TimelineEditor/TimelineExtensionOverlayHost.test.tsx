// @vitest-environment jsdom
import React, { useState, type ComponentType } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ResolvedTimelineOverlayDescriptor,
  TimelineOverlayRenderProps,
} from '@reigh/editor-sdk';
import { createTimelineOverlayGeometry } from '@reigh/editor-sdk';
import {
  VideoEditorRuntimeProvider,
  type VideoEditorRuntimeContextValue,
} from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import { createTimelineOverlayStores } from '@/tools/video-editor/lib/timeline-overlay-stores.ts';
import type { TimelineGestureOwner } from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import { TimelineExtensionOverlayHost } from './TimelineExtensionOverlayHost.tsx';

const geometry = createTimelineOverlayGeometry({
  scale: 1,
  scaleWidth: 100,
  startLeft: 20,
  extentStart: 0,
  extentEnd: 100,
});

function descriptor(
  extensionId: string,
  contributionId: string,
  Renderer: ComponentType<TimelineOverlayRenderProps>,
): ResolvedTimelineOverlayDescriptor {
  return {
    extensionId,
    id: contributionId as never,
    renderId: `${contributionId}/render`,
    render: Renderer,
  };
}

function runtime(overlays: readonly ResolvedTimelineOverlayDescriptor[]): VideoEditorRuntimeContextValue {
  return {
    provider: {} as VideoEditorRuntimeContextValue['provider'],
    assetResolver: {} as VideoEditorRuntimeContextValue['assetResolver'],
    auth: { userId: 'user-1' },
    project: { projectId: 'project-1' },
    shots: {} as VideoEditorRuntimeContextValue['shots'],
    mediaLightbox: {} as VideoEditorRuntimeContextValue['mediaLightbox'],
    agentChat: {} as VideoEditorRuntimeContextValue['agentChat'],
    toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
    telemetry: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    timelineId: 'timeline-1',
    userId: 'user-1',
    extensions: {
      slots: {},
      dialogHost: { dialogs: [] },
      registry: { panels: [], inspectorSections: [] },
      overlays,
    },
    timelineOverlaysEnabled: true,
    getRecoveryKey: () => '1',
    incrementRecoveryKey: () => '2',
  };
}

function renderOverlayHost(
  overlays: readonly ResolvedTimelineOverlayDescriptor[],
  initialOwner: TimelineGestureOwner = 'none',
) {
  const contentPortalRoot = document.createElement('div');
  const rulerPortalRoot = document.createElement('div');
  const rulerStripRoot = document.createElement('div');
  const scrollContainer = document.createElement('div');
  rulerPortalRoot.appendChild(rulerStripRoot);
  document.body.append(contentPortalRoot, rulerPortalRoot, scrollContainer);
  const stores = createTimelineOverlayStores({
    viewport: { scheduleFrame: (callback) => { callback(); return 1; } },
  });
  const ownerChanges: TimelineGestureOwner[] = [];
  const setContextTarget = vi.fn();
  const setInspectorTarget = vi.fn();
  let stealOwner: (owner: TimelineGestureOwner) => void = () => {};
  let observedOwner: TimelineGestureOwner = initialOwner;

  function Harness({
    currentOverlays,
    featureEnabled = true,
    extensionEnabled = true,
  }: {
    currentOverlays: readonly ResolvedTimelineOverlayDescriptor[];
    featureEnabled?: boolean;
    extensionEnabled?: boolean;
  }) {
    const [owner, setOwner] = useState(initialOwner);
    stealOwner = setOwner;
    observedOwner = owner;
    return (
      <VideoEditorRuntimeProvider value={runtime(extensionEnabled ? currentOverlays : [])}>
        {featureEnabled && (
          <TimelineExtensionOverlayHost
            contentPortalRoot={contentPortalRoot}
            rulerPortalRoot={rulerPortalRoot}
            rulerStripRoot={rulerStripRoot}
            scrollContainer={scrollContainer}
            geometry={geometry}
            stores={stores}
            selection={{ selectedClipIds: new Set(), hasSelection: false }}
            fps={24}
            gestureOwner={owner}
            setGestureOwner={(next) => {
              ownerChanges.push(next);
              setOwner(next);
            }}
            setContextTarget={setContextTarget}
            setInspectorTarget={setInspectorTarget}
          />
        )}
      </VideoEditorRuntimeProvider>
    );
  }

  const view = render(<Harness currentOverlays={overlays} />);
  return {
    ...view,
    contentPortalRoot,
    rulerPortalRoot,
    rulerStripRoot,
    scrollContainer,
    stores,
    ownerChanges,
    setContextTarget,
    setInspectorTarget,
    getOwner: () => observedOwner,
    setOwnerInCurrentBatch: (owner: TimelineGestureOwner) => stealOwner(owner),
    stealOwner: (owner: TimelineGestureOwner) => act(() => stealOwner(owner)),
    disableFeatureFlag: () => {
      view.rerender(<Harness currentOverlays={overlays} featureEnabled={false} />);
    },
    disableExtension: () => {
      view.rerender(<Harness currentOverlays={overlays} extensionEnabled={false} />);
    },
    rerenderOverlays: (next: readonly ResolvedTimelineOverlayDescriptor[]) => {
      view.rerender(<Harness currentOverlays={next} />);
    },
  };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('TimelineExtensionOverlayHost', () => {
  it('keeps roots and passive contribution wrappers click-through', () => {
    const Renderer = vi.fn(() => <div data-testid="passive-overlay">passive</div>);
    const host = renderOverlayHost([descriptor('ext.passive', 'passive', Renderer)]);

    expect(host.contentPortalRoot).toHaveStyle({ pointerEvents: 'none' });
    expect(host.rulerPortalRoot).toHaveStyle({ pointerEvents: 'none' });
    expect(screen.getByTestId('passive-overlay').parentElement).toHaveStyle({
      pointerEvents: 'none',
    });
    expect(Renderer).toHaveBeenCalledTimes(1);
  });

  it('arbitrates synchronously between overlays and owner-checks stale releases', () => {
    const results: boolean[] = [];
    let firstProps: TimelineOverlayRenderProps | null = null;
    let secondProps: TimelineOverlayRenderProps | null = null;
    const First = (props: TimelineOverlayRenderProps) => {
      firstProps = props;
      return <button style={{ pointerEvents: 'auto' }} onPointerDown={() => results.push(props.claimPointer())}>first</button>;
    };
    const Second = (props: TimelineOverlayRenderProps) => {
      secondProps = props;
      return <button style={{ pointerEvents: 'auto' }} onPointerDown={() => results.push(props.claimPointer())}>second</button>;
    };
    const host = renderOverlayHost([
      descriptor('ext.one', 'one', First),
      descriptor('ext.two', 'two', Second),
    ]);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'first' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'second' }));
    expect(results).toEqual([true, false]);
    expect(firstProps?.pointerClaimed).toBe(true);
    expect(secondProps?.pointerClaimed).toBe(false);
    expect(host.setContextTarget).toHaveBeenLastCalledWith({
      kind: 'overlay', extensionId: 'ext.one', contributionId: 'one',
    });
    expect(host.setInspectorTarget).toHaveBeenCalledTimes(1);

    const wrappers = [
      screen.getByTestId('timeline-extension-overlay-ext.one-one'),
      screen.getByTestId('timeline-extension-overlay-ext.two-two'),
    ];
    expect(wrappers.filter((wrapper) => wrapper.style.pointerEvents === 'auto')).toHaveLength(1);
    expect(wrappers.filter((wrapper) => wrapper.hasAttribute('data-overlay-interactive'))).toHaveLength(1);
    expect(wrappers[0]).toHaveStyle({ pointerEvents: 'auto' });
    expect(wrappers[0]).toHaveAttribute('data-overlay-interactive', 'true');
    expect(wrappers[1]).toHaveStyle({ pointerEvents: 'none' });
    expect(wrappers[1]).not.toHaveAttribute('data-overlay-interactive');

    act(() => secondProps?.releasePointer());
    expect(firstProps?.pointerClaimed).toBe(true);
    act(() => firstProps?.releasePointer());
    expect(host.ownerChanges.at(-1)).toBe('none');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'second' }));
    act(() => firstProps?.releasePointer());
    expect(secondProps?.pointerClaimed).toBe(true);
    expect(wrappers.filter((wrapper) => wrapper.style.pointerEvents === 'auto')).toHaveLength(1);
    expect(wrappers.filter((wrapper) => wrapper.hasAttribute('data-overlay-interactive'))).toHaveLength(1);
    expect(wrappers[0]).toHaveStyle({ pointerEvents: 'none' });
    expect(wrappers[0]).not.toHaveAttribute('data-overlay-interactive');
    expect(wrappers[1]).toHaveStyle({ pointerEvents: 'auto' });
    expect(wrappers[1]).toHaveAttribute('data-overlay-interactive', 'true');
  });

  it('cancels same-batch pre-acknowledgement theft without clearing the foreign owner', () => {
    let props: TimelineOverlayRenderProps | null = null;
    const Overlay = (next: TimelineOverlayRenderProps) => {
      props = next;
      return <div />;
    };
    const host = renderOverlayHost([descriptor('ext.race', 'race', Overlay)]);

    act(() => {
      expect(props?.claimPointer()).toBe(true);
      host.setOwnerInCurrentBatch('clip');
    });

    const wrapper = screen.getByTestId('timeline-extension-overlay-ext.race-race');
    expect(host.getOwner()).toBe('clip');
    expect(host.ownerChanges).toEqual(['overlay']);
    expect(props?.pointerClaimed).toBe(false);
    expect(wrapper).toHaveStyle({ pointerEvents: 'none' });
    expect(wrapper).not.toHaveAttribute('data-overlay-interactive');
    expect(props?.claimPointer()).toBe(false);
    expect(host.getOwner()).toBe('clip');

    fireEvent.pointerUp(window);
    expect(host.getOwner()).toBe('clip');
    expect(host.ownerChanges).toEqual(['overlay']);
  });

  it('rejects foreign gesture owners without changing targets', () => {
    let props: TimelineOverlayRenderProps | null = null;
    const Overlay = (next: TimelineOverlayRenderProps) => {
      props = next;
      return <div />;
    };
    const host = renderOverlayHost([descriptor('ext.foreign', 'foreign', Overlay)], 'clip');
    expect(props?.claimPointer()).toBe(false);
    expect(host.ownerChanges).toEqual([]);
    expect(host.setContextTarget).not.toHaveBeenCalled();
    expect(host.setInspectorTarget).not.toHaveBeenCalled();
  });

  it.each(['pointerup', 'pointercancel', 'blur'] as const)(
    'releases a direct claim on %s',
    (terminalEvent) => {
      let props: TimelineOverlayRenderProps | null = null;
      const Overlay = (next: TimelineOverlayRenderProps) => {
        props = next;
        return <div />;
      };
      const host = renderOverlayHost([descriptor('ext.term', 'term', Overlay)]);
      act(() => { props?.claimPointer(); });
      fireEvent(window, new Event(terminalEvent));
      expect(host.ownerChanges.at(-1)).toBe('none');
      expect(props?.pointerClaimed).toBe(false);
    },
  );

  it.each([
    ['feature-flag disable', (host: ReturnType<typeof renderOverlayHost>) => host.disableFeatureFlag()],
    ['extension disable', (host: ReturnType<typeof renderOverlayHost>) => host.disableExtension()],
  ] as const)('releases an active claim on %s', (_path, disable) => {
    let props: TimelineOverlayRenderProps | null = null;
    const Overlay = (next: TimelineOverlayRenderProps) => {
      props = next;
      return <div />;
    };
    const host = renderOverlayHost([descriptor('ext.disable', 'active', Overlay)]);

    act(() => { expect(props?.claimPointer()).toBe(true); });
    expect(props?.pointerClaimed).toBe(true);

    disable(host);

    expect(host.ownerChanges.at(-1)).toBe('none');
    expect(host.getOwner()).toBe('none');
    expect(screen.queryByTestId('timeline-extension-overlay-ext.disable-active')).toBeNull();
  });

  it('releases on visibility loss, theft, descriptor removal, and unmount', () => {
    let props: TimelineOverlayRenderProps | null = null;
    const Overlay = (next: TimelineOverlayRenderProps) => {
      props = next;
      return <div />;
    };
    const item = descriptor('ext.life', 'life', Overlay);
    const host = renderOverlayHost([item]);

    act(() => { props?.claimPointer(); });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    expect(host.ownerChanges.at(-1)).toBe('none');

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { props?.claimPointer(); });
    host.stealOwner('clip');
    expect(props?.pointerClaimed).toBe(false);
    expect(host.ownerChanges.at(-1)).toBe('overlay');

    host.stealOwner('none');
    act(() => { props?.claimPointer(); });
    host.rerenderOverlays([]);
    expect(host.ownerChanges.at(-1)).toBe('none');

    host.rerenderOverlays([item]);
    act(() => { props?.claimPointer(); });
    host.unmount();
    expect(host.ownerChanges.at(-1)).toBe('none');
  });

  it('isolates renderer crashes and releases the crashing contribution claim', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let claimThenCrash = () => {};
    const Broken = (props: TimelineOverlayRenderProps) => {
      const [crashed, setCrashed] = useState(false);
      claimThenCrash = () => {
        props.claimPointer();
        setCrashed(true);
      };
      if (crashed) throw new Error('overlay exploded');
      return <div>before crash</div>;
    };
    const Healthy = () => <div data-testid="healthy-overlay">healthy</div>;
    const host = renderOverlayHost([
      descriptor('ext.broken', 'broken', Broken),
      descriptor('ext.healthy', 'healthy', Healthy),
    ]);

    act(() => claimThenCrash());
    expect(screen.getByRole('alert')).toHaveTextContent('Timeline overlay error');
    expect(screen.getByTestId('healthy-overlay')).toBeInTheDocument();
    expect(host.ownerChanges.at(-1)).toBe('none');
  });

  it('uses one imperatively translated ruler strip for marker portals', () => {
    const Overlay = (props: TimelineOverlayRenderProps) => <>
      {props.primitives.markerLayer({
        markers: [
          { id: 'interactive', time: 1 },
          { id: 'disabled', time: 2, disabled: true },
        ],
        interactive: true,
        snap: true,
      }) as React.ReactNode}
      {props.primitives.markerLayer({
        markers: [{ id: 'passive', time: 3 }],
        interactive: false,
        snap: true,
      }) as React.ReactNode}
    </>;
    const host = renderOverlayHost([descriptor('ext.marker', 'marker', Overlay)]);
    expect(host.rulerStripRoot.querySelector('[data-marker-id="interactive"]')).toHaveStyle({
      touchAction: 'none',
    });
    expect(host.rulerStripRoot.querySelector('[data-marker-id="disabled"]')).not.toHaveStyle({
      touchAction: 'none',
    });
    expect(host.rulerStripRoot.querySelector('[data-marker-id="passive"]')).not.toHaveStyle({
      touchAction: 'none',
    });

    act(() => host.stores.frameTime.publish({ timestamp: 1, scrollLeft: 73, scrollTop: 0 }));
    expect(host.rulerStripRoot).toHaveStyle({ transform: 'translateX(-73px)' });
  });
});
