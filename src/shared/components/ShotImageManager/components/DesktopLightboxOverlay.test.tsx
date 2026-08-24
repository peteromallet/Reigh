// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopLightboxOverlay } from './DesktopLightboxOverlay';

const mediaLightboxSpy = vi.fn();

vi.mock('@/domains/media-lightbox/MediaLightbox', () => ({
  MediaLightbox: (props: unknown) => {
    mediaLightboxSpy(props);
    const typedProps = props as {
      onClose?: () => void;
      actions?: { onDelete?: () => void };
      onNavigateToGeneration?: (id: string) => void;
      shotWorkflow?: { onShotChange?: (shotId: string) => void };
    };

    return (
      <div data-testid="media-lightbox">
        <button data-testid="close-lightbox" onClick={() => typedProps.onClose?.()}>Close</button>
        <button data-testid="delete-image" onClick={() => typedProps.actions?.onDelete?.()}>Delete</button>
        <button
          data-testid="navigate-generation"
          onClick={() => typedProps.onNavigateToGeneration?.('img-2')}
        >
          Navigate
        </button>
        <button data-testid="change-shot" onClick={() => typedProps.shotWorkflow?.onShotChange?.('shot-2')}>
          Change shot
        </button>
      </div>
    );
  },
}));

type OverlayProps = React.ComponentProps<typeof DesktopLightboxOverlay>;

function createProps(overrides: Partial<OverlayProps> = {}): OverlayProps {
  const lightbox = {
    lightboxIndex: 0,
    setLightboxIndex: vi.fn(),
    shouldAutoEnterInpaint: true,
    setShouldAutoEnterInpaint: vi.fn(),
    currentImages: [
      { id: 'img-1', shotImageEntryId: 'entry-1', timeline_frame: 12, shot_id: 'shot-1', starred: true },
      { id: 'img-2', shotImageEntryId: 'entry-2', timeline_frame: 24, shot_id: 'shot-1', starred: false },
    ],
    handleNext: vi.fn(),
    handlePrevious: vi.fn(),
  } as OverlayProps['lightbox'];

  const optimistic = {
    optimisticOrder: [{ id: 'img-1' }, { id: 'img-2' }],
  } as OverlayProps['optimistic'];

  const externalGens = {
    derivedNavContext: null,
    setDerivedNavContext: vi.fn(),
    setTempDerivedGenerations: vi.fn(),
    externalGenLightboxSelectedShot: 'shot-external',
    setExternalGenLightboxSelectedShot: vi.fn(),
    handleOpenExternalGeneration: vi.fn(),
    handleExternalGenAddToShot: vi.fn(),
    handleExternalGenAddToShotWithoutPosition: vi.fn(),
  } as OverlayProps['externalGens'];

  const managerProps = {
    images: [
      { id: 'img-1', shotImageEntryId: 'entry-1' },
      { id: 'img-2', shotImageEntryId: 'entry-2' },
    ],
    onImageDelete: vi.fn(),
    onImageReorder: vi.fn(),
    generationMode: 'batch',
    shotId: 'shot-1',
    selectedShotId: 'shot-1',
    allShots: [{ id: 'shot-1', name: 'Shot 1' }],
    onShotChange: vi.fn(),
    onAddToShot: vi.fn(),
    onAddToShotWithoutPosition: vi.fn(),
    onCreateShot: vi.fn(),
  } as OverlayProps['managerProps'];

  return {
    lightbox,
    optimistic,
    externalGens,
    managerProps,
    lightboxSelectedShotId: 'shot-1',
    setLightboxSelectedShotId: vi.fn(),
    taskDetailsData: undefined,
    capturedVariantIdRef: { current: 'variant-1' },
    showTickForImageId: null,
    onShowTick: vi.fn(),
    showTickForSecondaryImageId: null,
    onShowSecondaryTick: vi.fn(),
    onNavigateToShot: vi.fn(),
    adjacentSegments: [],
    ...overrides,
  };
}

function getLastLightboxProps() {
  return mediaLightboxSpy.mock.calls.at(-1)?.[0] as {
    navigation: { hasNext: boolean; hasPrevious: boolean };
    actions: { onDelete?: () => void };
    shotWorkflow: {
      selectedShotId?: string;
      positionedInSelectedShot?: boolean;
      associatedWithoutPositionInSelectedShot?: boolean;
    };
  };
}

describe('DesktopLightboxOverlay', () => {
  beforeEach(() => {
    mediaLightboxSpy.mockClear();
  });

  it('returns null when no active lightbox image exists', () => {
    const props = createProps({
      lightbox: {
        ...createProps().lightbox,
        lightboxIndex: null,
      },
    });

    const { container } = render(<DesktopLightboxOverlay {...props} />);
    expect(container).toBeEmptyDOMElement();
    expect(mediaLightboxSpy).not.toHaveBeenCalled();
  });

  it('passes internal navigation state and resets lightbox state on close', () => {
    const props = createProps();
    render(<DesktopLightboxOverlay {...props} />);

    const rendered = getLastLightboxProps();
    expect(rendered.navigation.hasNext).toBe(true);
    expect(rendered.navigation.hasPrevious).toBe(false);

    fireEvent.click(screen.getByTestId('close-lightbox'));

    expect(props.capturedVariantIdRef.current).toBeNull();
    expect(props.lightbox.setLightboxIndex).toHaveBeenCalledWith(null);
    expect(props.lightbox.setShouldAutoEnterInpaint).toHaveBeenCalledWith(false);
    expect(props.externalGens.setDerivedNavContext).toHaveBeenCalledWith(null);
    expect(props.externalGens.setTempDerivedGenerations).toHaveBeenCalledWith([]);
    expect(props.externalGens.setExternalGenLightboxSelectedShot).not.toHaveBeenCalled();
    expect(props.setLightboxSelectedShotId).toHaveBeenCalledWith('shot-1');
  });

  it('uses external generation shot workflow and close behavior when index is external', () => {
    const props = createProps({
      lightbox: {
        ...createProps().lightbox,
        lightboxIndex: 1,
      },
      optimistic: {
        optimisticOrder: [{ id: 'img-1' }],
      } as OverlayProps['optimistic'],
    });

    render(<DesktopLightboxOverlay {...props} />);
    expect(getLastLightboxProps().shotWorkflow.selectedShotId).toBe('shot-external');

    fireEvent.click(screen.getByTestId('change-shot'));
    expect(props.externalGens.setExternalGenLightboxSelectedShot).toHaveBeenCalledWith('shot-2');
    expect(props.managerProps.onShotChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('close-lightbox'));
    expect(props.externalGens.setExternalGenLightboxSelectedShot).toHaveBeenLastCalledWith('shot-1');
  });

  it('wires internal delete, shot change, and generation navigation callbacks', () => {
    const props = createProps();
    render(<DesktopLightboxOverlay {...props} />);

    fireEvent.click(screen.getByTestId('delete-image'));
    expect(props.managerProps.onImageDelete).toHaveBeenCalledWith('img-1');

    fireEvent.click(screen.getByTestId('change-shot'));
    expect(props.setLightboxSelectedShotId).toHaveBeenCalledWith('shot-2');
    expect(props.managerProps.onShotChange).toHaveBeenCalledWith('shot-2');

    fireEvent.click(screen.getByTestId('navigate-generation'));
    expect(props.lightbox.setLightboxIndex).toHaveBeenCalledWith(1);
  });

  it('derives navigation and association state from derived context and shot associations', () => {
    const props = createProps({
      lightbox: {
        ...createProps().lightbox,
        currentImages: [
          {
            id: 'derived-2',
            shotImageEntryId: 'entry-derived-2',
            timeline_frame: null,
            all_shot_associations: [{ shot_id: 'shot-5', timeline_frame: null }],
          },
        ],
      } as OverlayProps['lightbox'],
      managerProps: {
        ...(createProps().managerProps as OverlayProps['managerProps']),
        selectedShotId: 'shot-5',
      },
      lightboxSelectedShotId: 'shot-5',
      externalGens: {
        ...(createProps().externalGens as OverlayProps['externalGens']),
        derivedNavContext: {
          sourceGenerationId: 'derived-1',
          derivedGenerationIds: ['derived-1', 'derived-2', 'derived-3'],
        },
      },
    });

    render(<DesktopLightboxOverlay {...props} />);
    const rendered = getLastLightboxProps();

    expect(rendered.navigation.hasNext).toBe(true);
    expect(rendered.navigation.hasPrevious).toBe(true);
    expect(rendered.shotWorkflow.positionedInSelectedShot).toBe(false);
    expect(rendered.shotWorkflow.associatedWithoutPositionInSelectedShot).toBe(true);
  });
});
