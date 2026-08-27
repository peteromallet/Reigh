import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const {
  mockCreateTask,
  mockAddIncomingTask,
  mockRemoveIncomingTask,
  mockResolveTaskIds,
  mockToast,
} = vi.hoisted(() => ({
  mockCreateTask: vi.fn(),
  mockAddIncomingTask: vi.fn().mockReturnValue('incoming-1'),
  mockRemoveIncomingTask: vi.fn(),
  mockResolveTaskIds: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock('@/shared/lib/taskCreation', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}));

vi.mock('@/shared/components/ui/runtime/sonner', () => ({
  toast: Object.assign(mockToast, {
    error: mockToast,
    success: mockToast,
    warning: mockToast,
    info: mockToast,
  }),
}));

vi.mock('@/shared/lib/queryKeys', () => ({
  queryKeys: {
    tasks: {
      all: ['tasks'],
      paginatedAll: ['tasks', 'paginated'],
      statusCountsAll: ['tasks', 'statusCounts'],
    },
    unified: {
      projectPrefix: (id: string | null) => ['unified', id],
    },
  },
}));

vi.mock('@/shared/contexts/IncomingTasksContext', () => ({
  useIncomingTasks: () => ({
    addIncomingTask: mockAddIncomingTask,
    removeIncomingTask: mockRemoveIncomingTask,
    resolveTaskIds: mockResolveTaskIds,
    cancelIncoming: vi.fn(),
    cancelAllIncoming: vi.fn(),
    wasCancelled: vi.fn(() => false),
    acknowledgeCancellation: vi.fn(),
  }),
}));

vi.mock('@/shared/lib/media/aspectRatios', () => ({
  ASPECT_RATIO_TO_RESOLUTION: {
    '16:9': '1280x720',
    '1:1': '1024x1024',
  },
}));

vi.mock('@/shared/lib/tooling/toolIds', () => ({
  TOOL_IDS: {
    JOIN_CLIPS: 'join_clips',
  },
}));

vi.mock('@/shared/lib/vaceDefaults', () => ({
  DEFAULT_VACE_PHASE_CONFIG: [{ phase: 'default' }],
  BUILTIN_VACE_DEFAULT_ID: 'builtin-default',
  VACE_GENERATION_DEFAULTS: { model: 'wan_2_2_default' },
}));

vi.mock('@/shared/lib/joinClips/defaults', () => ({
  joinClipsSettings: {
    defaults: {
      contextFrameCount: 15,
      gapFrameCount: 23,
      replaceMode: true,
      keepBridgingImages: false,
      prompt: '',
      negativePrompt: '',
      useIndividualPrompts: false,
      enhancePrompt: false,
      useInputVideoResolution: false,
      useInputVideoFps: false,
      noisedInputVideo: 0,
      motionMode: 'simple',
      phaseConfig: null,
      selectedPhasePresetId: null,
    },
  },
}));

import { useJoinClipsGenerate } from '../useJoinClipsGenerate';
import type { VideoClip, TransitionPrompt } from '../../clipTypes';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function createClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: `clip-${Math.random().toString(36).slice(2)}`,
    url: 'https://example.com/video.mp4',
    loaded: false,
    playing: false,
    ...overrides,
  };
}

function createDefaultSettings() {
  return {
    settings: {
      prompt: 'global transition prompt',
      negativePrompt: '',
      contextFrameCount: 15,
      gapFrameCount: 23,
      replaceMode: true,
      keepBridgingImages: false,
      useIndividualPrompts: false,
      enhancePrompt: false,
      useInputVideoResolution: false,
      useInputVideoFps: false,
      noisedInputVideo: 0,
      loopFirstClip: false,
      motionMode: 'simple',
      phaseConfig: null,
      model: 'wan_2_2_default',
      numInferenceSteps: 20,
      guidanceScale: 7.5,
      seed: null,
      priority: 'normal',
      selectedPhasePresetId: null,
    },
    updateField: vi.fn(),
    updateFields: vi.fn(),
  };
}

describe('useJoinClipsGenerate', () => {
  const clips = [createClip({ id: 'c1' }), createClip({ id: 'c2' })];
  const transitionPrompts: TransitionPrompt[] = [];
  const loraManager = {
    selectedLoras: [] as unknown[],
    setSelectedLoras: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTask.mockResolvedValue({ task_id: 'task-1', status: 'queued' });
  });

  it('returns initial state', () => {
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.showSuccessState).toBe(false);
    expect(result.current.isGenerateDisabled).toBe(false);
    expect(typeof result.current.handleGenerate).toBe('function');
    expect(typeof result.current.handleRestoreDefaults).toBe('function');
  });

  it('generates correct button text for 2 clips', () => {
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.generateButtonText).toBe('Generate 1 transition');
  });

  it('generates correct button text for 3 clips', () => {
    const threeClips = [createClip(), createClip(), createClip()];
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips: threeClips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.generateButtonText).toBe('Generate 2 transitions');
  });

  it('generates loop text for single clip with loopFirstClip', () => {
    const settings = createDefaultSettings();
    settings.settings.loopFirstClip = true;

    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips: [createClip()],
          transitionPrompts,
          joinSettings: settings as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.generateButtonText).toBe('Generate Loop');
  });

  it('disables generate when fewer than 2 clips have URLs', () => {
    const mixedClips = [createClip(), createClip({ url: '' })];
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips: mixedClips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isGenerateDisabled).toBe(true);
  });

  it('disables generate when clips have metadataLoading', () => {
    const loadingClips = [
      createClip(),
      createClip({ metadataLoading: true }),
    ];
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips: loadingClips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isGenerateDisabled).toBe(true);
  });

  it('shows toast error when trying to generate with fewer than 2 clips', () => {
    const singleClip = [createClip()];
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips: singleClip,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleGenerate();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Need at least 2 clips',
        variant: 'destructive',
      }),
    );
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('creates join clips task with correct params', async () => {
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleGenerate();
    });

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'proj-1',
          family: 'join_clips',
          input: expect.objectContaining({
            mode: 'multi_clip',
            clip_source: expect.objectContaining({
              kind: 'clips',
              clips: expect.arrayContaining([
                { url: expect.any(String) },
                { url: expect.any(String) },
              ]),
            }),
            context_frame_count: 15,
            gap_frame_count: 23,
            replace_mode: true,
            tool_type: 'join_clips',
          }),
        }),
      );
      expect(mockResolveTaskIds).toHaveBeenCalledWith('incoming-1', ['task-1']);
    });
  });

  it('handles individual prompts when useIndividualPrompts is true', async () => {
    const settings = createDefaultSettings();
    settings.settings.useIndividualPrompts = true;
    const prompts: TransitionPrompt[] = [{ id: 'c2', prompt: 'smooth transition' }];

    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts: prompts,
          joinSettings: settings as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleGenerate();
    });

    await waitFor(() => {
      const callArgs = mockCreateTask.mock.calls[0][0].input;
      // Individual prompt + global prompt should be combined
      expect(callArgs.per_join_settings[0].prompt).toBe(
        'smooth transition. global transition prompt',
      );
    });
  });

  it('adds resolution from project aspect ratio', async () => {
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleGenerate();
    });

    await waitFor(() => {
      const callArgs = mockCreateTask.mock.calls[0][0].input;
      expect(callArgs.resolution).toEqual([1280, 720]);
    });
  });

  it('adds loras when available', async () => {
    const lorasWithItems = {
      selectedLoras: [
        { path: 'lora/path1', strength: 0.8 },
        { path: 'lora/path2', strength: 0.5 },
      ],
      setSelectedLoras: vi.fn(),
    };

    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: lorasWithItems as unknown,
          projectAspectRatio: undefined,
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleGenerate();
    });

    await waitFor(() => {
      const callArgs = mockCreateTask.mock.calls[0][0].input;
      expect(callArgs.loras).toEqual([
        { path: 'lora/path1', strength: 0.8 },
        { path: 'lora/path2', strength: 0.5 },
      ]);
    });
  });

  it('restores defaults correctly', () => {
    const settings = createDefaultSettings();
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: settings as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleRestoreDefaults();
    });

    expect(settings.updateFields).toHaveBeenCalledWith(
      expect.objectContaining({
        contextFrameCount: 15,
        gapFrameCount: 23,
        replaceMode: true,
      }),
    );
    expect(loraManager.setSelectedLoras).toHaveBeenCalledWith([]);
  });

  it('scales restore defaults to fit shortest clip', () => {
    const settings = createDefaultSettings();
    const validation = {
      valid: false,
      shortestClipFrames: 20,
      maxSafeGap: 10,
      maxSafeContext: 5,
      minClipFramesRequired: 53,
    };

    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: settings as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: validation,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleRestoreDefaults();
    });

    // The defaults (gap=23, context=15) need 53 frames total (23 + 2*15)
    // With only 20 frames, scale factor = 20/53 = ~0.377
    // Scaled context = max(4, floor(15 * 0.377)) = max(4, 5) = 5
    // Scaled gap = max(1, floor(23 * 0.377)) = max(1, 8) = 8
    const calls = settings.updateFields.mock.calls[0][0];
    expect(calls.contextFrameCount).toBeGreaterThanOrEqual(4);
    expect(calls.gapFrameCount).toBeGreaterThanOrEqual(1);
  });

  it('adds incoming task during generation', async () => {
    const { result } = renderHook(
      () =>
        useJoinClipsGenerate({
          selectedProjectId: 'proj-1',
          clips,
          transitionPrompts,
          joinSettings: createDefaultSettings() as unknown,
          loraManager: loraManager as unknown,
          projectAspectRatio: '16:9',
          validationResult: null,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleGenerate();
    });

    await waitFor(() => {
      expect(mockAddIncomingTask).toHaveBeenCalledWith({
        taskType: 'join_clips',
        label: 'Join 2 clips',
      });
    });
  });
});
