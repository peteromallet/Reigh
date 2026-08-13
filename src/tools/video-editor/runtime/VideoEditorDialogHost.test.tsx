// @vitest-environment jsdom
/**
 * T7.1 — dialog family host-consumer evidence.
 *
 * Mounts the real `VideoEditorDialogHost` with real dialog descriptors and
 * proves the dialog host contract end to end:
 *
 *   1. Descriptors render their content into layer-scoped host containers
 *      (`data-video-editor-dialog-id` / `data-video-editor-dialog-layer`),
 *      deterministically sorted by `order` then `id`.
 *   2. `when` predicates are evaluated against the live render context —
 *      `when: false` descriptors are omitted, `when: true` descriptors render.
 *   3. Extension-supplied dialogs (from `useVideoEditorDialogDescriptors`)
 *      and registry-contributed dialogs (`useVideoEditorDialogRegistration`)
 *      are merged into the same host surface.
 *   4. A throwing dialog renderer is contained by the host-owned dialog
 *      error boundary (`ContributionErrorBoundary kind="dialog"`) and
 *      converted into fallback UI instead of crashing the editor tree.
 *
 * Only the render-context plumbing module is stubbed (matching the
 * TimelineEditorShellCore.test.tsx pattern); the host itself and every
 * descriptor are real.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useVideoEditorRenderContext: vi.fn(),
  useVideoEditorDialogDescriptors: vi.fn(),
}));

vi.mock('@/tools/video-editor/runtime/useVideoEditorRenderContext.ts', () => ({
  useVideoEditorRenderContext: mocks.useVideoEditorRenderContext,
  useVideoEditorDialogDescriptors: mocks.useVideoEditorDialogDescriptors,
}));

import { ContributionErrorBoundary } from './ContributionErrorBoundary';
import type {
  VideoEditorDialogDescriptor,
  VideoEditorRenderContext,
} from './extensionSurface';
import {
  VideoEditorDialogHost,
  useVideoEditorDialogRegistration,
} from './VideoEditorDialogHost';

function buildRenderContext(): VideoEditorRenderContext {
  return {
    provider: {} as never,
    timelineId: 'timeline-1',
    timelineName: 'Demo timeline',
    userId: 'user-1',
    extensions: {
      slots: {},
      dialogHost: { dialogs: [] },
      registry: { panels: [], inspectorSections: [] },
      overlays: [],
    } as never,
    data: {} as never,
    ops: {} as never,
    chrome: {} as never,
    playback: {} as never,
  } as VideoEditorRenderContext;
}

function makeDialog(
  overrides: Partial<VideoEditorDialogDescriptor> = {},
): VideoEditorDialogDescriptor {
  return {
    id: 'dialog.a',
    layer: 'modal',
    render: () => <div data-testid="dialog-a-content">Dialog A content</div>,
    ...overrides,
  };
}

describe('VideoEditorDialogHost', () => {
  beforeEach(() => {
    mocks.useVideoEditorRenderContext.mockReturnValue(buildRenderContext());
    mocks.useVideoEditorDialogDescriptors.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders every dialog descriptor with layer metadata', () => {
    render(
      <VideoEditorDialogHost
        dialogs={[
          makeDialog({
            id: 'modal.dialog',
            layer: 'modal',
            render: () => <div data-testid="modal-content">Modal dialog</div>,
          }),
          makeDialog({
            id: 'overlay.dialog',
            layer: 'overlay',
            render: () => <div data-testid="overlay-content">Overlay dialog</div>,
          }),
          makeDialog({
            id: 'default-layer.dialog',
            render: () => <div data-testid="default-layer-content">Default layer</div>,
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('modal-content')).toHaveTextContent('Modal dialog');
    expect(screen.getByTestId('overlay-content')).toHaveTextContent('Overlay dialog');

    const modalHost = screen
      .getByTestId('modal-content')
      .closest('[data-video-editor-dialog-id="modal.dialog"]');
    expect(modalHost).toBeTruthy();
    expect(modalHost).toHaveAttribute('data-video-editor-dialog-layer', 'modal');

    const overlayHost = screen
      .getByTestId('overlay-content')
      .closest('[data-video-editor-dialog-layer="overlay"]');
    expect(overlayHost).toBeTruthy();

    // Explicit layer is optional — the host defaults it to "modal".
    expect(
      screen
        .getByTestId('default-layer-content')
        .closest('[data-video-editor-dialog-layer="modal"]'),
    ).toBeTruthy();
  });

  it('sorts descriptors by order then id before rendering', () => {
    const renderA = vi.fn(() => <div data-testid="content-a">A</div>);
    const renderB = vi.fn(() => <div data-testid="content-b">B</div>);
    const renderC = vi.fn(() => <div data-testid="content-c">C</div>);

    render(
      <VideoEditorDialogHost
        dialogs={[
          makeDialog({ id: 'b', order: 20, render: renderB }),
          makeDialog({ id: 'a', order: 10, render: renderA }),
          makeDialog({ id: 'c', order: 10, render: renderC }),
        ]}
      />,
    );

    const firstCallOrder = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0];
    expect(firstCallOrder(renderA)).toBeLessThan(firstCallOrder(renderC));
    expect(firstCallOrder(renderC)).toBeLessThan(firstCallOrder(renderB));
  });

  it('omits descriptors whose when predicate returns false and passes the render context', () => {
    const whenTrue = vi.fn(() => true);
    const whenFalse = vi.fn(() => false);

    render(
      <VideoEditorDialogHost
        dialogs={[
          makeDialog({
            id: 'visible.dialog',
            when: whenTrue,
            render: () => <div data-testid="visible-content">Visible</div>,
          }),
          makeDialog({
            id: 'hidden.dialog',
            when: whenFalse,
            render: () => <div data-testid="hidden-content">Hidden</div>,
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('visible-content')).toBeInTheDocument();
    expect(screen.queryByTestId('hidden-content')).not.toBeInTheDocument();

    expect(whenTrue).toHaveBeenCalledWith(
      expect.objectContaining({ timelineId: 'timeline-1', userId: 'user-1' }),
    );
    expect(whenFalse).toHaveBeenCalledWith(
      expect.objectContaining({ timelineId: 'timeline-1', timelineName: 'Demo timeline' }),
    );
  });

  it('renders extension dialogs supplied by the extension runtime', () => {
    mocks.useVideoEditorDialogDescriptors.mockReturnValue([
      makeDialog({
        id: 'extension.dialog',
        render: () => <div data-testid="extension-content">Extension dialog</div>,
      }),
    ]);

    render(<VideoEditorDialogHost />);

    expect(screen.getByTestId('extension-content')).toBeInTheDocument();
  });

  it('renders registry-contributed dialogs and removes them on unmount', async () => {
    const registeredDialogs: readonly VideoEditorDialogDescriptor[] = [
      makeDialog({
        id: 'registered.dialog',
        render: () => <div data-testid="registered-content">Registered</div>,
      }),
    ];

    function ContributingDialogConsumer() {
      useVideoEditorDialogRegistration(registeredDialogs);
      return null;
    }

    const view = render(
      <VideoEditorDialogHost>
        <ContributingDialogConsumer />
      </VideoEditorDialogHost>,
    );

    expect(await screen.findByTestId('registered-content')).toBeInTheDocument();

    view.unmount();
    expect(screen.queryByTestId('registered-content')).not.toBeInTheDocument();
  });

  it('contains a throwing dialog render inside the dialog error boundary', () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <>
        <div data-testid="outside-boundary">Editor chrome</div>
        <ContributionErrorBoundary
          contributionId="dialog.boom"
          kind="dialog"
          label="Boom dialog"
          onError={onError}
        >
          <VideoEditorDialogHost
            dialogs={[
              makeDialog({
                id: 'boom.dialog',
                render: () => {
                  throw new Error('dialog render exploded');
                },
              }),
            ]}
          />
        </ContributionErrorBoundary>
      </>,
    );

    // The crash is contained: sibling editor chrome survives and the
    // dialog-specific fallback renders instead of an uncaught exception.
    expect(screen.getByTestId('outside-boundary')).toBeInTheDocument();

    const fallback = screen.getByRole('alert');
    expect(fallback).toHaveAttribute('data-video-editor-contribution-error', 'true');
    expect(fallback).toHaveAttribute('data-video-editor-contribution-kind', 'dialog');
    expect(screen.getByText(/Dialog error/)).toBeInTheDocument();
    expect(screen.getByText(/Boom dialog/)).toBeInTheDocument();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        contributionId: 'dialog.boom',
        kind: 'dialog',
        error: expect.objectContaining({ message: 'dialog render exploded' }),
      }),
    );

    consoleError.mockRestore();
  });
});
