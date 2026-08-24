import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createShot: vi.fn(),
  duplicateShotGroup: vi.fn(async () => ({})),
  promotePrimaryVariant: vi.fn(async () => []),
  reloadFromServer: vi.fn(async () => undefined),
  galleryGet: vi.fn(async () => ({
    generation_id: 'gen-a',
    variants: [
      { id: 'variant-current', is_primary: true },
      { id: 'variant-next', is_primary: false },
    ],
  })),
}));

const data = {
  config: {
    output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
    tracks: [{ id: 'V1', kind: 'visual', label: 'Visual' }],
    clips: [],
    pinnedShotGroups: [],
  },
  configVersion: 13,
  registry: { assets: {} },
  resolvedConfig: { registry: {} },
  rows: [{ id: 'V1', actions: [] }],
  meta: {},
};
const dataRef = { current: data };

vi.mock('@/shared/contexts/ShotsContext.tsx', () => ({ useShots: () => ({ shots: [] }) }));
vi.mock('@/shared/hooks/shotCreation/useShotCreation.ts', () => ({
  useShotCreation: () => ({ createShot: mocks.createShot, isCreating: false }),
}));
vi.mock('@/shared/hooks/shots/useShotNavigation.ts', () => ({ useShotNavigation: () => ({ navigateToShot: vi.fn() }) }));
vi.mock('@/shared/contexts/ProjectContext.tsx', () => ({
  useProjectSelectionContext: () => ({ selectedProjectId: 'astrid-project' }),
}));
vi.mock('@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx', () => ({
  useVideoEditorRuntime: () => ({
    userId: null,
    timelineId: 'active-non-default',
    project: { projectId: 'astrid-project' },
    provider: { apiBaseUrl: 'http://bridge.fake' },
  }),
}));
vi.mock('@/tools/video-editor/hooks/timelineStore.ts', () => ({
  useTimelineConfigVersion: () => 13,
  useTimelineDataSelector: (selector: (value: unknown) => unknown) => selector({
    data,
    resolvedConfig: data.resolvedConfig,
    dataRef,
    selectedClipIds: new Set<string>(),
    interactionStateRef: { current: { drag: false, resize: false } },
  }),
  useTimelineOpsSelector: (selector: (value: unknown) => unknown) => selector({
    applyEdit: vi.fn(),
    patchRegistry: vi.fn(),
    unpatchRegistry: vi.fn(),
    registerAsset: vi.fn(),
    registerGenerationAsset: vi.fn(),
    reloadFromServer: mocks.reloadFromServer,
  }),
  useTimelineChromeSelector: (selector: (value: unknown) => unknown) => selector({
    reloadFromServer: mocks.reloadFromServer,
  }),
}));
vi.mock('@/tools/video-editor/hooks/usePinnedShotGroups.ts', () => ({
  usePinnedShotGroups: () => ({ pinGroup: vi.fn(), unpinGroup: vi.fn() }),
  usePinnedShotGroupViews: () => [],
  usePinnedGroupSync: vi.fn(),
}));
vi.mock('@/tools/video-editor/hooks/useShotGroups.ts', () => ({
  useShotGroups: () => [{
    shotId: 'shot-a',
    shotName: 'Shot A',
    rowId: 'V1',
    rowIndex: 0,
    start: 0,
    clipIds: [],
    children: [],
    color: '#fff',
    poolGenerationIds: [],
    variantIdsByGenerationId: { 'gen-a': 'variant-current' },
  }],
}));
vi.mock('@/tools/video-editor/hooks/useActiveTaskClips.ts', () => ({ useActiveTaskClips: () => ({ activeTaskAssetKeys: new Set() }) }));
vi.mock('@/tools/video-editor/hooks/useFinalVideoAvailable.ts', () => ({
  useFinalVideoAvailable: () => ({ finalVideoMap: new Map(), dismissFinalVideo: vi.fn() }),
}));
vi.mock('@/tools/video-editor/hooks/useSwitchToFinalVideo.ts', () => ({
  useSwitchToFinalVideo: () => ({ switchToFinalVideo: vi.fn(), updateToLatestVideo: vi.fn(), switchToImages: vi.fn() }),
}));
vi.mock('@/tools/video-editor/hooks/useShotGroupHandlers.ts', () => ({
  useShotGroupHandlers: () => ({
    shotGroupClipIds: new Set(), activeTaskClipIds: new Set(), staleShotGroupIds: new Set(),
    handleShotGroupNavigate: vi.fn(), handleShotGroupGenerateVideo: vi.fn(), handleDeleteShotGroup: vi.fn(),
    handleUpdateToLatestVideo: vi.fn(), handleShotGroupUnpin: vi.fn(), handleShotGroupSwitchToFinalVideo: vi.fn(),
    handleShotGroupSwitchToImages: vi.fn(),
  }),
}));
vi.mock('@/tools/video-editor/lib/shot-group-pack-commands.ts', () => ({
  duplicateShotGroup: mocks.duplicateShotGroup,
  promotePrimaryVariant: mocks.promotePrimaryVariant,
}));
vi.mock('@/integrations/astrid/client.ts', () => ({
  AstridLocalClient: class {
    gallery = { get: mocks.galleryGet };
  },
}));
vi.mock('@/tools/video-editor/components/TimelineEditor/TimelineEditorCore.tsx', () => ({
  resolveSelectedGenerationIdsForShotCreation: () => ({ canCreateShot: false, generationIds: [] }),
  TimelineEditorCore: (props: {
    onShotGroupDuplicate?: (locator: { shotId: string; trackId: string }) => void;
    onShotGroupPromotePrimary?: (locator: { shotId: string; trackId: string }) => void;
    onShotGroupNavigate?: unknown;
    onShotGroupGenerateVideo?: unknown;
  }) => (
    <div>
      <button onClick={() => props.onShotGroupDuplicate?.({ shotId: 'shot-a', trackId: 'V1' })}>Duplicate document shot</button>
      <button onClick={() => props.onShotGroupPromotePrimary?.({ shotId: 'shot-a', trackId: 'V1' })}>Promote document variant</button>
      <output data-testid="relational-actions">{String(Boolean(props.onShotGroupNavigate || props.onShotGroupGenerateVideo))}</output>
    </div>
  ),
}));
vi.mock('@/tools/video-editor/lib/generation-utils.ts', () => ({ duplicateGenerationAsset: vi.fn() }));
vi.mock('@/tools/travel-between-images/components/VideoGenerationModal.tsx', () => ({ VideoGenerationModal: () => null }));

import { ReighTimelineEditor } from './ReighTimelineEditor.tsx';

describe('ReighTimelineEditor document-derived shot consumer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('targets the active timeline/version, refreshes, and leaves relational shot actions dormant', async () => {
    render(<ReighTimelineEditor />);
    expect(screen.getByTestId('relational-actions')).toHaveTextContent('false');

    fireEvent.click(screen.getByText('Duplicate document shot'));
    await waitFor(() => expect(mocks.duplicateShotGroup).toHaveBeenCalledWith(expect.objectContaining({
      projectSlug: 'astrid-project',
      timelineRef: 'active-non-default',
      configVersion: 13,
      source: { shotId: 'shot-a', trackId: 'V1' },
    })));

    fireEvent.click(screen.getByText('Promote document variant'));
    await waitFor(() => expect(mocks.promotePrimaryVariant).toHaveBeenCalledWith({
      projectSlug: 'astrid-project',
      timelineRef: 'active-non-default',
      configVersion: 13,
      generationId: 'gen-a',
      variantId: 'variant-next',
    }));

    expect(mocks.reloadFromServer).toHaveBeenCalledTimes(2);
    expect(mocks.createShot).not.toHaveBeenCalled();
  });
});
