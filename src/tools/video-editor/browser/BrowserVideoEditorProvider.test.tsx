import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserVideoEditorProvider } from '@/tools/video-editor/browser/BrowserVideoEditorProvider';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';

const runtimeProviderSpy = vi.fn();

vi.mock('@/tools/video-editor/contexts/EditorRuntimeProvider', () => ({
  EditorRuntimeProvider: ({ children, ...props }: any) => {
    runtimeProviderSpy(props);
    return <div data-testid="runtime-provider">{children}</div>;
  },
}));

const provider: DataProvider = {
  loadTimeline: vi.fn(),
  saveTimeline: vi.fn(),
  loadAssetRegistry: vi.fn(),
  resolveAssetUrl: vi.fn(async (file: string) => file),
};

function slotRenderer(label: string) {
  return () => label;
}

afterEach(() => {
  runtimeProviderSpy.mockClear();
});

describe('BrowserVideoEditorProvider', () => {
  it('mounts the standalone runtime without importing the stock shell', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        timelineName="Provider demo"
        userId={null}
        hostContext={{ projectId: 'project-1' }}
      >
        <div data-testid="custom-shell">Custom shell</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('Custom shell');
    expect(runtimeProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      dataProvider: provider,
      timelineId: 'timeline-1',
      timelineName: 'Provider demo',
      userId: null,
      runtime: expect.objectContaining({
        hostContext: { projectId: 'project-1' },
      }),
    }));
  });

  // ---- extension threading negative coverage (no-input / disabled-input) ----

  it('mounts normally when extensions is omitted (undefined)', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
      >
        <div data-testid="custom-shell">No extensions</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('No extensions');
    // extensions omitted → runtime provider receives undefined
    expect(runtimeProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: undefined }),
    );
  });

  it('mounts normally when extensions is an empty array', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={[]}
      >
        <div data-testid="custom-shell">Empty extensions</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('Empty extensions');
  });

  it('mounts normally when all extensions are disabled', () => {
    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={[
          { enabled: false, slots: { toolbar: slotRenderer('hidden') } },
          { enabled: false },
        ]}
      >
        <div data-testid="custom-shell">All disabled</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(screen.getByTestId('custom-shell')).toHaveTextContent('All disabled');
  });

  it('threads extensions prop through to EditorRuntimeProvider', () => {
    const ext = { slots: { statusBar: slotRenderer('test-status') } };

    render(
      <BrowserVideoEditorProvider
        dataProvider={provider}
        timelineId="timeline-1"
        extensions={ext}
      >
        <div data-testid="custom-shell">With extension</div>
      </BrowserVideoEditorProvider>,
    );

    expect(screen.getByTestId('runtime-provider')).toBeInTheDocument();
    expect(runtimeProviderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: ext }),
    );
  });
});
