import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  TimelineOverlayGeometry,
  TimelineMarkerLayerOptions,
  TimelineOverlayPrimitives,
  TimelineOverlayRenderProps,
  TimelineOverlaySelection,
} from '@reigh/editor-sdk';
import { OVERLAY_INTERACTIVE_ATTR } from '@/tools/video-editor/lib/timeline-dom.ts';
import type {
  TimelineContextTarget,
  TimelineGestureOwner,
  TimelineInspectorTarget,
} from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import type { TimelineOverlayStores } from '@/tools/video-editor/lib/timeline-overlay-stores.ts';
import { HostContributionErrorBoundary } from '@/tools/video-editor/runtime/ContributionErrorBoundary.tsx';
import { useVideoEditorTimelineOverlays } from '@/tools/video-editor/runtime/useVideoEditorRenderContext.ts';
import { TimelineMarkerLayer } from './TimelineMarkerLayer.tsx';

export interface TimelineExtensionOverlayHostProps {
  /** Canvas-owned content-coordinate portal root inside the scroll content. */
  contentPortalRoot: HTMLElement | null;
  /** Canvas-owned ruler portal root outside the scroll container. */
  rulerPortalRoot: HTMLElement | null;
  /** The single canvas-owned strip translated opposite horizontal scrolling. */
  rulerStripRoot: HTMLElement | null;
  /** Canvas-owned scroller; marker gestures use it for coordinates/auto-scroll. */
  scrollContainer: HTMLElement | null;
  geometry: TimelineOverlayGeometry;
  stores: TimelineOverlayStores;
  selection: TimelineOverlaySelection;
  fps: number;
  gestureOwner: TimelineGestureOwner;
  setGestureOwner: (owner: TimelineGestureOwner) => void;
  setContextTarget: (target: TimelineContextTarget) => void;
  setInspectorTarget: (target: TimelineInspectorTarget) => void;
}

interface OverlayContributionProps {
  descriptor: ReturnType<typeof useVideoEditorTimelineOverlays>[number];
  claimantKey: string;
  claimedKey: string | null;
  claimEpoch: number;
  contentPortalRoot: HTMLElement;
  rulerStripRoot: HTMLElement;
  scrollContainer: HTMLElement;
  geometry: TimelineOverlayGeometry;
  stores: TimelineOverlayStores;
  selection: TimelineOverlaySelection;
  fps: number;
  overlayCount: number;
  layerIndex: number;
  claimPointer: (
    claimantKey: string,
    extensionId: string,
    contributionId: string,
  ) => boolean;
  releasePointer: (claimantKey: string) => void;
}

function OverlayContribution({
  descriptor,
  claimantKey,
  claimedKey,
  claimEpoch,
  contentPortalRoot,
  rulerStripRoot,
  scrollContainer,
  geometry,
  stores,
  selection,
  fps,
  overlayCount,
  layerIndex,
  claimPointer,
  releasePointer,
}: OverlayContributionProps) {
  const claimed = claimedKey === claimantKey;
  const claim = useCallback(
    () => claimPointer(
      claimantKey,
      descriptor.extensionId,
      String(descriptor.id),
    ),
    [claimPointer, claimantKey, descriptor.extensionId, descriptor.id],
  );
  const release = useCallback(
    () => releasePointer(claimantKey),
    [claimantKey, releasePointer],
  );
  const releaseRef = useRef(release);
  releaseRef.current = release;
  const getScrollContainer = useCallback(() => scrollContainer, [scrollContainer]);

  useEffect(() => () => releaseRef.current(), []);

  const primitives = useMemo<TimelineOverlayPrimitives>(() => Object.freeze({
    markerLayer<T = unknown>(options: TimelineMarkerLayerOptions<T>): unknown {
      return createPortal(
        <TimelineMarkerLayer<T>
          {...options}
          geometry={geometry}
          viewport={stores.viewport}
          fps={fps}
          getScrollContainer={getScrollContainer}
          claimPointer={claim}
          releasePointer={release}
          overlayCount={overlayCount}
          layerIndex={layerIndex}
          layerKey={claimantKey}
        />,
        rulerStripRoot,
        `${claimantKey}:marker-layer:${claimEpoch}`,
      );
    },
  }), [claim, claimEpoch, claimantKey, fps, geometry, getScrollContainer, overlayCount, layerIndex, release, rulerStripRoot, stores.viewport]);

  const renderProps = useMemo<TimelineOverlayRenderProps>(() => Object.freeze({
    geometry,
    viewport: stores.viewport,
    playhead: stores.playhead,
    selection,
    pointerClaimed: claimed,
    claimPointer: claim,
    releasePointer: release,
    primitives,
  }), [claim, claimed, geometry, primitives, release, selection, stores.playhead, stores.viewport]);

  // A registered renderer is treated as a React component. Besides preserving
  // hooks semantics, this makes each contribution independently catchable.
  const Renderer = descriptor.render as ComponentType<TimelineOverlayRenderProps>;
  const wrapper = (
    <div
      data-testid={`timeline-extension-overlay-${descriptor.extensionId}-${String(descriptor.id)}`}
      data-extension-id={descriptor.extensionId}
      data-contribution-id={String(descriptor.id)}
      {...(claimed ? { [OVERLAY_INTERACTIVE_ATTR]: 'true' } : {})}
      className="absolute inset-0"
      style={{ pointerEvents: claimed ? 'auto' : 'none' }}
    >
      <HostContributionErrorBoundary
        extensionId={descriptor.extensionId}
        contributionId={String(descriptor.id)}
        kind="timelineOverlay"
        onHostFailure={release}
      >
        <Renderer {...renderProps} />
      </HostContributionErrorBoundary>
    </div>
  );

  return createPortal(wrapper, contentPortalRoot, claimantKey);
}

/**
 * Host for all resolved timeline-overlay contributions.
 *
 * The record in `claimantRef` is intentionally synchronous: two extensions
 * claiming during the same browser event cannot both observe an unowned
 * gesture. React state mirrors the record only for rendering.
 */
export function TimelineExtensionOverlayHost({
  contentPortalRoot,
  rulerPortalRoot,
  rulerStripRoot,
  scrollContainer,
  geometry,
  stores,
  selection,
  fps,
  gestureOwner,
  setGestureOwner,
  setContextTarget,
  setInspectorTarget,
}: TimelineExtensionOverlayHostProps) {
  const overlays = useVideoEditorTimelineOverlays();
  const claimantRef = useRef<string | null>(null);
  const ownerAcknowledgedRef = useRef(false);
  const gestureOwnerRef = useRef(gestureOwner);
  gestureOwnerRef.current = gestureOwner;
  const settersRef = useRef({
    setGestureOwner,
    setContextTarget,
    setInspectorTarget,
  });
  settersRef.current = { setGestureOwner, setContextTarget, setInspectorTarget };
  const [claimedKey, setClaimedKey] = useState<string | null>(null);
  const [claimEpoch, setClaimEpoch] = useState(0);

  const releasePointer = useCallback((claimantKey: string) => {
    if (claimantRef.current !== claimantKey) {
      return;
    }

    claimantRef.current = null;
    setClaimedKey(null);
    setClaimEpoch((epoch) => epoch + 1);

    // A foreign owner represents ownership theft. Never let a stale overlay
    // release clear it; only clear the owner we still own.
    const currentOwner = gestureOwnerRef.current;
    if (currentOwner === 'overlay') {
      gestureOwnerRef.current = 'none';
      settersRef.current.setGestureOwner('none');
    }
    ownerAcknowledgedRef.current = false;
  }, []);

  const claimPointer = useCallback((
    claimantKey: string,
    extensionId: string,
    contributionId: string,
  ): boolean => {
    const currentClaimant = claimantRef.current;
    if (currentClaimant !== null) {
      // Ownership can be stolen in the same React batch as the original
      // claim, before the parent ever renders the requested overlay owner.
      // Terminate synchronously and preserve the foreign owner.
      const currentOwner = gestureOwnerRef.current;
      if (currentOwner !== 'none' && currentOwner !== 'overlay') {
        releasePointer(currentClaimant);
        return false;
      }
      return currentClaimant === claimantKey;
    }
    if (gestureOwnerRef.current !== 'none') {
      return false;
    }

    claimantRef.current = claimantKey;
    ownerAcknowledgedRef.current = false;
    gestureOwnerRef.current = 'overlay';
    setClaimedKey(claimantKey);
    settersRef.current.setGestureOwner('overlay');

    const target = { kind: 'overlay' as const, extensionId, contributionId };
    settersRef.current.setContextTarget(target);
    settersRef.current.setInspectorTarget(target);
    return true;
  }, [releasePointer]);

  // The ruler root remains click-through; one child strip carries all marker
  // layers and follows horizontal scroll without a React render.
  useLayoutEffect(() => {
    if (!contentPortalRoot || !rulerPortalRoot || !rulerStripRoot) {
      return;
    }
    contentPortalRoot.style.pointerEvents = 'none';
    rulerPortalRoot.style.pointerEvents = 'none';
    rulerStripRoot.style.pointerEvents = 'none';
    rulerStripRoot.style.transform = `translateX(-${stores.viewport.getSnapshot().scrollLeft}px)`;
    const handle = stores.frameTime.subscribe(({ scrollLeft }) => {
      rulerStripRoot.style.transform = `translateX(-${scrollLeft}px)`;
    });
    return () => handle.dispose();
  }, [contentPortalRoot, rulerPortalRoot, rulerStripRoot, stores.frameTime, stores.viewport]);

  // Foreign ownership is theft even if it arrives in the same batch as the
  // claim, before the parent acknowledges `overlay`. Once acknowledged, a
  // transition to `none` also ends the claim. Releasing bumps the marker portal
  // key, which unmounts the active drag state machine immediately.
  useEffect(() => {
    const claimant = claimantRef.current;
    if (!claimant) {
      return;
    }
    if (gestureOwner === 'overlay') {
      ownerAcknowledgedRef.current = true;
      return;
    }
    if (gestureOwner !== 'none' || ownerAcknowledgedRef.current) {
      releasePointer(claimant);
    }
  }, [gestureOwner, releasePointer]);

  // Host-level terminal paths cover renderers that use claimPointer directly,
  // not only the host marker primitive's pointer state machine.
  useEffect(() => {
    if (!claimedKey) {
      return;
    }
    const finish = () => releasePointer(claimedKey);
    const visibility = () => {
      if (document.visibilityState !== 'visible') {
        finish();
      }
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [claimedKey, releasePointer]);

  useEffect(() => () => {
    const claimant = claimantRef.current;
    if (claimant) {
      releasePointer(claimant);
    }
  }, [releasePointer]);

  if (!contentPortalRoot || !rulerPortalRoot || !rulerStripRoot || !scrollContainer) {
    return null;
  }

  return overlays.map((descriptor, layerIndex) => {
    const claimantKey = `${descriptor.extensionId}:${String(descriptor.id)}`;
    return (
      <OverlayContribution
        key={claimantKey}
        descriptor={descriptor}
        claimantKey={claimantKey}
        claimedKey={claimedKey}
        claimEpoch={claimEpoch}
        contentPortalRoot={contentPortalRoot}
        rulerStripRoot={rulerStripRoot}
        scrollContainer={scrollContainer}
        geometry={geometry}
        stores={stores}
        selection={selection}
        fps={fps}
        overlayCount={overlays.length}
        layerIndex={layerIndex}
        claimPointer={claimPointer}
        releasePointer={releasePointer}
      />
    );
  }) as ReactNode;
}
