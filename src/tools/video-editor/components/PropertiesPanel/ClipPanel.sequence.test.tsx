import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ClipPanel, getVisibleClipTabs } from '@/tools/video-editor/components/PropertiesPanel/ClipPanel';
import type { ClipTab } from '@/tools/video-editor/hooks/useEditorPreferences';
import type { ResolvedTimelineClip, ResolvedTimelineConfig, TrackDefinition } from '@/tools/video-editor/types';

vi.mock('@/shared/components/ui/input', () => ({
  Input: ({ onChange, value, ...props }: ComponentProps<'input'>) => (
    <input value={value} onChange={onChange} {...props} />
  ),
}));

vi.mock('@/shared/components/ui/textarea', () => ({
  Textarea: ({ onChange, value, ...props }: ComponentProps<'textarea'>) => (
    <textarea value={value} onChange={onChange} {...props} />
  ),
}));

vi.mock('@/shared/components/ui/number-input', () => ({
  NumberInput: ({ onChange, value, min, max, step }: {
    onChange: (value: number | null) => void;
    value: number | null;
    min?: number;
    max?: number;
    step?: number;
  }) => (
    <input
      role="spinbutton"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))}
    />
  ),
}));

vi.mock('@/tools/video-editor/contexts/DataProviderContext', () => ({
  useVideoEditorRuntime: () => ({ userId: 'user-1' }),
}));

vi.mock('@/tools/video-editor/hooks/useEffectResources', () => ({
  useEffectResources: () => ({
    effects: [],
    entrance: [],
    exit: [],
    continuous: [],
  }),
}));

vi.mock('@/tools/video-editor/components/EffectCreatorPanel', () => ({
  EffectCreatorPanel: () => null,
}));

vi.mock('@banodoco/timeline-composition/registry.generated', async () => ({
  THEME_PACKAGE_REGISTRY: {
    'resource-card': {
      component: () => null,
      themeId: '2rp',
      source: 'installed:@banodoco/timeline-theme-2rp',
    },
    'section-hook': {
      component: () => null,
      themeId: '2rp',
      source: 'installed:@banodoco/timeline-theme-2rp',
    },
  },
}));

const visualTrack: TrackDefinition = {
  id: 'visual-1',
  kind: 'visual',
  label: 'Visual 1',
};

const registry: ResolvedTimelineConfig['registry'] = {
  'asset-a': {
    file: 'asset-a.png',
    src: 'https://cdn.example.test/asset-a.png',
    type: 'image/png',
  },
  'asset-b': {
    file: 'asset-b.png',
    src: 'https://cdn.example.test/asset-b.png',
    type: 'image/png',
  },
  'asset-c': {
    file: 'asset-c.png',
    src: 'https://cdn.example.test/asset-c.png',
    type: 'image/png',
  },
  'asset-d': {
    file: 'asset-d.png',
    src: 'https://cdn.example.test/asset-d.png',
    type: 'image/png',
  },
};

const sequenceClip: ResolvedTimelineClip = {
  id: 'sequence-1',
  clipType: 'resource-card',
  track: 'visual-1',
  at: 1,
  hold: 4,
  params: {
    title: 'Old title',
    detail: 'Old detail',
    previewAssetKeys: ['asset-a'],
  },
};

const titleCardClip: ResolvedTimelineClip = {
  id: 'title-card-1',
  clipType: 'title-card',
  track: 'visual-1',
  at: 1,
  hold: 4,
  params: {
    kicker: 'INTRO',
    title: 'Registry Title',
    subtitle: 'Example subtitle',
  },
};

const renderClipPanel = ({
  clip = sequenceClip,
  activeTab = 'effects',
  onChange = vi.fn(),
}: {
  clip?: ResolvedTimelineClip;
  activeTab?: ClipTab;
  onChange?: ReturnType<typeof vi.fn>;
} = {}) => {
  const setActiveTab = vi.fn();

  const result = render(
    <ClipPanel
      clip={clip}
      track={visualTrack}
      deviceClass="desktop"
      interactionMode="move"
      precisionEnabled={false}
      hasPredecessor={false}
      onChange={onChange}
      onResetPosition={vi.fn()}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onToggleMute={vi.fn()}
      onDetachAudio={vi.fn()}
      onSplitAtPlayhead={vi.fn()}
      onMoveTrackUp={vi.fn()}
      onMoveTrackDown={vi.fn()}
      onSetInteractionMode={vi.fn()}
      onSetPrecisionEnabled={vi.fn()}
      compositionWidth={1920}
      compositionHeight={1080}
      registry={registry}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      timelineFps={30}
    />,
  );

  return { ...result, onChange, setActiveTab };
};

describe('ClipPanel sequence inspector', () => {
  it('routes registered sequence clips to the sequence tab without animation controls', () => {
    expect(getVisibleClipTabs(sequenceClip, visualTrack)).toEqual(['effects', 'timing']);

    renderClipPanel();

    expect(screen.getAllByText('2RP Resource Card').length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'Sequence' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Effects' })).not.toBeInTheDocument();
    expect(screen.queryByText('Entrance')).not.toBeInTheDocument();
    expect(screen.queryByText('Exit')).not.toBeInTheDocument();
    expect(screen.queryByText('Continuous')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create effect/i })).not.toBeInTheDocument();
  });

  it('persists string and asset-key param edits through params patches', () => {
    const { onChange } = renderClipPanel();

    fireEvent.change(screen.getByDisplayValue('Old title'), {
      target: { value: 'New title' },
    });

    expect(onChange).toHaveBeenCalledWith({
      params: {
        title: 'New title',
        detail: 'Old detail',
        previewAssetKeys: ['asset-a'],
      },
    });

    fireEvent.change(screen.getByDisplayValue('asset-a'), {
      target: { value: 'asset-a, https://example.test/raw.png, missing-key, asset-b, asset-c, asset-d' },
    });

    expect(onChange).toHaveBeenCalledWith({
      params: {
        title: 'Old title',
        detail: 'Old detail',
        previewAssetKeys: ['asset-a', 'asset-b', 'asset-c'],
      },
    });
  });

  it('collapses repeated generated asset keys into counted chips until manual comma-input edits', () => {
    const { onChange } = renderClipPanel({
      clip: {
        ...sequenceClip,
        clipType: 'image-jump',
        params: {
          imageAssetKeys: ['asset-a', 'asset-a', 'asset-b'],
          mode: 'jump',
        },
      },
    });

    expect(screen.getByDisplayValue('asset-a, asset-b')).toBeInTheDocument();
    expect(screen.getByText('3/8 uses')).toBeInTheDocument();
    expect(screen.getByText('2 assets')).toBeInTheDocument();
    expect(screen.getByText('asset-a x2')).toBeInTheDocument();
    expect(screen.getByText('asset-b')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/asset-a, asset-a/)).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByDisplayValue('asset-a, asset-b'), {
      target: { value: 'asset-b, asset-a' },
    });

    expect(onChange).toHaveBeenCalledWith({
      params: {
        imageAssetKeys: ['asset-b', 'asset-a'],
        mode: 'jump',
      },
    });
  });

  it('edits sequence timing as hold duration instead of media source timing', () => {
    const { container, onChange } = renderClipPanel({ activeTab: 'timing' });

    expect(screen.getByText('Duration (seconds)')).toBeInTheDocument();
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    expect(screen.queryByText('Source In')).not.toBeInTheDocument();
    expect(screen.queryByText('Source Out')).not.toBeInTheDocument();

    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[1], { target: { value: '6' } });

    expect(onChange).toHaveBeenCalledWith({ hold: 6 });
  });

  it('warns loudly when a trusted sequence clip is unavailable in the current editor registry', () => {
    renderClipPanel({
      clip: {
        ...sequenceClip,
        clipType: 'cta-card',
      },
    });

    expect(screen.getByText(/is trusted in the clip-type registry, but its render component is not available/i)).toBeInTheDocument();
  });

  it('renders locally-registered title-card clips through the same sequence inspector path', () => {
    const { onChange } = renderClipPanel({
      clip: titleCardClip,
    });

    expect(getVisibleClipTabs(titleCardClip, visualTrack)).toEqual(['effects', 'timing']);
    expect(screen.getAllByText('Title Card').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('Registry Title')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Registry Title'), {
      target: { value: 'Updated Registry Title' },
    });

    expect(onChange).toHaveBeenCalledWith({
      params: {
        kicker: 'INTRO',
        title: 'Updated Registry Title',
        subtitle: 'Example subtitle',
      },
    });
  });

  it('uses command-aware tabs so non-audio hold clips hide audio controls while video media clips keep them', () => {
    expect(getVisibleClipTabs({
      id: 'hold-1',
      clipType: 'hold',
      track: 'visual-1',
      at: 0,
      hold: 3,
    }, visualTrack)).toEqual(['effects', 'timing', 'position']);

    expect(getVisibleClipTabs({
      id: 'media-1',
      clipType: 'media',
      track: 'visual-1',
      at: 0,
      from: 0,
      to: 4,
      assetEntry: {
        file: 'clip.mp4',
        src: 'https://cdn.example.test/clip.mp4',
        type: 'video/mp4',
      },
    }, visualTrack)).toEqual(['effects', 'timing', 'position', 'audio']);
  });
});
