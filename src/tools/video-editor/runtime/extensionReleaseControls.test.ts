import { describe, expect, it, vi } from 'vitest';
import { defineExtension } from '@reigh/editor-sdk';
import {
  buildExtensionLifecycleOperationalEvents,
  createHostOwnedExtensionOperationalEmitter,
  createPrivacySafeExtensionTelemetryHost,
  EXTENSION_RELEASE_RUNTIME_CONFIG_TIMEOUT_MS,
  getExtensionReleaseFlags,
  initializeExtensionReleaseFlags,
  loadExtensionReleaseFlags,
  operationalCountBucket,
  parseExtensionReleaseRuntimeConfig,
  REVIEWED_PRODUCTION_EXTENSION_IDS,
  RUNAWAY_RELEASE_EXTENSION_ID,
  TRANSCRIPT_RELEASE_EXTENSION_ID,
  sanitizeExtensionOperationalEvent,
  selectReleaseEnabledExtensions,
} from './extensionReleaseControls';
import { RUNAWAY_TIMELINE_EXTENSION_ID } from '@/tools/video-editor/dev/runaway-timeline/extension';
import { TRANSCRIPT_LANE_EXTENSION_ID } from '@/tools/video-editor/dev/transcript-lane/extension';
import { devLocalExtensions } from '@/tools/video-editor/dev/localExtensions';

const extension = (id: string) => defineExtension({
  manifest: { id: id as never, version: '1.0.0', apiVersion: 1, license: 'MIT', label: id },
});

const operationalPolicy = {
  releaseRevision: 'rc1',
  extensionVersions: new Map([
    ['com.reigh.runaway-timeline', new Set(['1.0.0'])],
    ['com.reigh.example', new Set(['1.0.0'])],
  ]),
};

describe('extension release controls', () => {
  it('pins child rollout IDs to the actual bundled manifests', () => {
    expect(RUNAWAY_RELEASE_EXTENSION_ID).toBe(RUNAWAY_TIMELINE_EXTENSION_ID);
    expect(TRANSCRIPT_RELEASE_EXTENSION_ID).toBe(TRANSCRIPT_LANE_EXTENSION_ID);
    expect(new Set(REVIEWED_PRODUCTION_EXTENSION_IDS)).toEqual(new Set(
      devLocalExtensions.map((item) => item.manifest.id as string),
    ));
  });

  it('keeps DEV fast/default-open without issuing a runtime fetch', async () => {
    const fetchImpl = vi.fn();
    await expect(loadExtensionReleaseFlags({
      development: true,
      fetchImpl,
      origin: 'https://reigh.example',
    })).resolves.toMatchObject({
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: true,
      runawayTypedTimelineEnabled: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses the exact versioned shape and enforces the host parent', () => {
    expect(parseExtensionReleaseRuntimeConfig({
      schemaVersion: 1,
      revision: 'rc1-canary.3',
      extensions: {
        hostEnabled: true,
        transcriptCaptionFoundryEnabled: false,
        runawayTypedTimelineEnabled: true,
      },
    })).toEqual({
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: true,
      configurationRevision: 'rc1-canary.3',
    });
    expect(parseExtensionReleaseRuntimeConfig({
      schemaVersion: 1,
      revision: 'rc1-off',
      extensions: {
        hostEnabled: false,
        transcriptCaptionFoundryEnabled: true,
        runawayTypedTimelineEnabled: true,
      },
    })).toEqual({
      extensionHostEnabled: false,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: false,
      configurationRevision: 'rc1-off',
    });
  });

  it('rejects invalid revisions, schema drift, and non-boolean switches', () => {
    const valid = {
      schemaVersion: 1,
      revision: 'rc1',
      extensions: {
        hostEnabled: true,
        transcriptCaptionFoundryEnabled: true,
        runawayTypedTimelineEnabled: true,
      },
    };
    expect(parseExtensionReleaseRuntimeConfig({ ...valid, revision: '../bad' })).toBeNull();
    expect(parseExtensionReleaseRuntimeConfig({ ...valid, schemaVersion: 2 })).toBeNull();
    expect(parseExtensionReleaseRuntimeConfig({ ...valid, queryOverride: true })).toBeNull();
    expect(parseExtensionReleaseRuntimeConfig({
      ...valid,
      extensions: { ...valid.extensions, hostEnabled: 'true' },
    })).toBeNull();
  });

  it('loads only the fixed same-origin path and fails closed on errors or redirects', async () => {
    const validDocument = {
      schemaVersion: 1,
      revision: 'runtime-7',
      extensions: {
        hostEnabled: true,
        transcriptCaptionFoundryEnabled: true,
        runawayTypedTimelineEnabled: false,
      },
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(validDocument), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(loadExtensionReleaseFlags({
      development: false,
      origin: 'https://reigh.example/editor?extensionSmoke=1',
      fetchImpl,
    })).resolves.toMatchObject({
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: true,
      runawayTypedTimelineEnabled: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://reigh.example/runtime-config/v1/extensions.json',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
      }),
    );

    await expect(loadExtensionReleaseFlags({
      development: false,
      origin: 'https://reigh.example',
      fetchImpl: vi.fn(async () => { throw new Error('offline'); }),
    })).resolves.toMatchObject({ extensionHostEnabled: false });
    await expect(loadExtensionReleaseFlags({
      development: false,
      origin: 'https://reigh.example',
      fetchImpl: vi.fn(async () => ({
        ok: true,
        url: 'https://attacker.example/extensions.json',
        json: async () => validDocument,
      } as Response)),
    })).resolves.toMatchObject({ extensionHostEnabled: false });
  });

  it('aborts a hung production fetch and initializes the render snapshot closed', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Promise<Response>(() => {});
      });
      const initialization = initializeExtensionReleaseFlags({
        development: false,
        origin: 'https://reigh.example',
        fetchImpl,
      });
      await vi.advanceTimersByTimeAsync(EXTENSION_RELEASE_RUNTIME_CONFIG_TIMEOUT_MS);
      await expect(initialization).resolves.toMatchObject({
        extensionHostEnabled: false,
        transcriptCaptionFoundryEnabled: false,
        runawayTypedTimelineEnabled: false,
      });
      expect(getExtensionReleaseFlags({ development: false })).toMatchObject({
        extensionHostEnabled: false,
      });
      expect((fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('composes a caller abort signal and cleans up without waiting for timeout', async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const loading = loadExtensionReleaseFlags({
      development: false,
      origin: 'https://reigh.example',
      fetchImpl,
      signal: caller.signal,
    });
    caller.abort(new DOMException('navigation stopped', 'AbortError'));
    await expect(loading).resolves.toMatchObject({ extensionHostEnabled: false });
    expect((fetchImpl.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it('selects independent Transcript and Runaway children from reviewed bundled extensions', () => {
    const all = [
      extension('com.reigh.scene-phase-markers'),
      extension('com.reigh.unreviewed-local-example'),
      extension(TRANSCRIPT_LANE_EXTENSION_ID),
      extension(RUNAWAY_TIMELINE_EXTENSION_ID),
    ];
    expect(selectReleaseEnabledExtensions(all, {
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: true,
      configurationRevision: 'r1',
    }).map((item) => item.manifest.id)).toEqual([
      'com.reigh.scene-phase-markers',
      RUNAWAY_TIMELINE_EXTENSION_ID,
    ]);
  });

  it('accepts only host-owned manifest identities, versions, revisions, and error classes', () => {
    expect(sanitizeExtensionOperationalEvent({
      event: 'bridge.request',
      outcome: 'failure',
      releaseRevision: 'rc1',
      extensionId: 'com.reigh.runaway-timeline',
      extensionVersion: '1.0.0',
      errorClass: 'bridge.timeout',
      durationMs: 125,
      countBucket: '101-1000',
      browserFamily: 'chrome',
    }, operationalPolicy)).not.toBeNull();
    expect(sanitizeExtensionOperationalEvent({
      event: 'render.outcome',
      outcome: 'failure',
      releaseRevision: 'rc1',
      transcriptText: 'secret creative content',
    }, operationalPolicy)).toBeNull();
    expect(sanitizeExtensionOperationalEvent({
      event: 'extension.activation',
      outcome: 'failure',
      releaseRevision: 'rc1',
      extensionId: 'com.reigh.example',
      extensionVersion: '9.9.9',
      errorClass: 'activation.error',
    }, operationalPolicy)).toBeNull();
    expect(sanitizeExtensionOperationalEvent({
      event: 'extension.activation',
      outcome: 'failure',
      releaseRevision: 'rc1',
      extensionId: 'com.reigh.example',
      extensionVersion: '1.0.0',
      errorClass: 'attacker.free_form',
    }, operationalPolicy)).toBeNull();
    expect(sanitizeExtensionOperationalEvent({
      event: 'host.activation',
      outcome: 'success',
      releaseRevision: 'different-release',
    }, operationalPolicy)).toBeNull();
    expect(sanitizeExtensionOperationalEvent({
      event: 'render.outcome',
      outcome: 'success',
      releaseRevision: 'rc1',
      durationMs: 86_400_001,
    }, operationalPolicy)).toBeNull();
  });

  it('drops extension-authored metrics and forwards only host-owned events', () => {
    const sink = vi.fn();
    const telemetry = createPrivacySafeExtensionTelemetryHost();
    telemetry.log('caption text', { projectId: 'private' });
    telemetry.error(new Error('contains a path'));
    telemetry.log({ event: 'host.activation', outcome: 'success', releaseRevision: 'rc1' });
    expect(sink).not.toHaveBeenCalled();

    createHostOwnedExtensionOperationalEmitter(operationalPolicy, sink).emit({
      event: 'host.activation',
      outcome: 'success',
    });
    expect(sink).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith({
      event: 'host.activation', outcome: 'success', releaseRevision: 'rc1',
    });
  });

  it('contains hostile payloads and a failing analytics sink', () => {
    const payload = Object.defineProperty({}, 'event', {
      enumerable: true,
      get: () => { throw new Error('hostile getter'); },
    });
    expect(sanitizeExtensionOperationalEvent(payload, operationalPolicy)).toBeNull();

    const emitter = createHostOwnedExtensionOperationalEmitter(operationalPolicy, () => {
      throw new Error('analytics unavailable');
    });
    expect(() => emitter.emit({
      event: 'host.activation',
      outcome: 'success',
    })).not.toThrow();
  });

  it('buckets operational counts at fixed host-owned boundaries', () => {
    expect([0, 1, 10, 11, 100, 101, 1_000, 1_001, 10_000, 10_001].map(
      operationalCountBucket,
    )).toEqual([
      '0', '1-10', '1-10', '11-100', '11-100',
      '101-1000', '101-1000', '1001-10000', '1001-10000', '10001+',
    ]);
  });

  it('forwards bounded host emitters for persistence, render/export, and lane density', () => {
    const sink = vi.fn();
    const emitter = createHostOwnedExtensionOperationalEmitter(operationalPolicy, sink);
    emitter.emit({
      event: 'persistence.conflict',
      outcome: 'failure',
      errorClass: 'persistence.version_conflict',
    });
    emitter.emit({
      event: 'render.outcome',
      outcome: 'failure',
      errorClass: 'render.export_error',
      durationMs: 42,
    });
    emitter.emit({
      event: 'lane.density',
      outcome: 'success',
      countBucket: '101-1000',
    });
    expect(sink.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ event: 'persistence.conflict', releaseRevision: 'rc1' }),
      expect.objectContaining({ event: 'render.outcome', errorClass: 'render.export_error' }),
      expect.objectContaining({ event: 'lane.density', countBucket: '101-1000' }),
    ]);
  });

  it('emits lifecycle transitions once and disposal on removal', () => {
    const active = [{
      extensionId: 'com.reigh.example',
      extensionVersion: '1.0.0',
      activationKey: 'com.reigh.example:1',
      state: 'active' as const,
    }];
    expect(buildExtensionLifecycleOperationalEvents([], active, 'rc1')).toEqual([{
      event: 'extension.activation',
      outcome: 'success',
      releaseRevision: 'rc1',
      extensionId: 'com.reigh.example',
      extensionVersion: '1.0.0',
    }]);
    expect(buildExtensionLifecycleOperationalEvents(active, active, 'rc1')).toEqual([]);
    expect(buildExtensionLifecycleOperationalEvents(active, [{
      ...active[0],
      activationKey: 'com.reigh.example:2',
    }], 'rc1')).toEqual([
      expect.objectContaining({ event: 'extension.disposal', outcome: 'success' }),
      expect.objectContaining({ event: 'extension.activation', outcome: 'success' }),
    ]);
    expect(buildExtensionLifecycleOperationalEvents(active, [{
      ...active[0],
      state: 'failed',
    }], 'rc1')).toEqual([
      expect.objectContaining({ event: 'extension.disposal', outcome: 'success' }),
      expect.objectContaining({
        event: 'extension.activation', outcome: 'failure', errorClass: 'activation.error',
      }),
    ]);
    expect(buildExtensionLifecycleOperationalEvents(active, [], 'rc1')).toEqual([{
      event: 'extension.disposal',
      outcome: 'success',
      releaseRevision: 'rc1',
      extensionId: 'com.reigh.example',
      extensionVersion: '1.0.0',
    }]);
    expect(buildExtensionLifecycleOperationalEvents(active, [{
      ...active[0],
      state: 'inactive',
    }], 'rc1')).toEqual([expect.objectContaining({
      event: 'extension.disposal',
      extensionId: 'com.reigh.example',
    })]);
    expect(buildExtensionLifecycleOperationalEvents([{
      ...active[0],
      state: 'failed',
    }], [], 'rc1')).toEqual([]);
  });
});
