import { describe, expect, it, vi } from 'vitest';
import { defineExtension } from '@reigh/editor-sdk';
import {
  buildExtensionLifecycleOperationalEvents,
  createPrivacySafeExtensionTelemetryHost,
  EXTENSION_RELEASE_RUNTIME_CONFIG_TIMEOUT_MS,
  getExtensionReleaseFlags,
  initializeExtensionReleaseFlags,
  loadExtensionReleaseFlags,
  parseExtensionReleaseRuntimeConfig,
  RUNAWAY_RELEASE_EXTENSION_ID,
  TRANSCRIPT_RELEASE_EXTENSION_ID,
  sanitizeExtensionOperationalEvent,
  selectReleaseEnabledExtensions,
} from './extensionReleaseControls';
import { RUNAWAY_TIMELINE_EXTENSION_ID } from '@/tools/video-editor/dev/runaway-timeline/extension';
import { TRANSCRIPT_LANE_EXTENSION_ID } from '@/tools/video-editor/dev/transcript-lane/extension';

const extension = (id: string) => defineExtension({
  manifest: { id: id as never, version: '1.0.0', apiVersion: 1, license: 'MIT', label: id },
});

describe('extension release controls', () => {
  it('pins child rollout IDs to the actual bundled manifests', () => {
    expect(RUNAWAY_RELEASE_EXTENSION_ID).toBe(RUNAWAY_TIMELINE_EXTENSION_ID);
    expect(TRANSCRIPT_RELEASE_EXTENSION_ID).toBe(TRANSCRIPT_LANE_EXTENSION_ID);
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
      extension('com.reigh.creative'),
      extension(TRANSCRIPT_LANE_EXTENSION_ID),
      extension(RUNAWAY_TIMELINE_EXTENSION_ID),
    ];
    expect(selectReleaseEnabledExtensions(all, {
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: true,
      configurationRevision: 'r1',
    }).map((item) => item.manifest.id)).toEqual([
      'com.reigh.creative',
      RUNAWAY_TIMELINE_EXTENSION_ID,
    ]);
  });

  it('accepts only the privacy-safe fixed operational shape', () => {
    expect(sanitizeExtensionOperationalEvent({
      event: 'bridge.request',
      outcome: 'failure',
      releaseRevision: 'rc1',
      extensionId: 'com.reigh.runaway-timeline',
      errorClass: 'bridge.timeout',
      durationMs: 125,
      countBucket: '101-1000',
      browserFamily: 'chrome',
    })).not.toBeNull();
    expect(sanitizeExtensionOperationalEvent({
      event: 'render.outcome',
      outcome: 'failure',
      releaseRevision: 'rc1',
      transcriptText: 'secret creative content',
    })).toBeNull();
    expect(sanitizeExtensionOperationalEvent({
      event: 'render.outcome',
      outcome: 'failure',
      releaseRevision: 'rc1',
      errorClass: '/Users/person/private/file.mp4',
    })).toBeNull();
    for (const leakedIdentifier of [
      'project-550e8400-e29b-41d4-a716-446655440000',
      'timeline-01ARZ3NDEKTSV4RRFFQ69G5FAV',
      'token-eyJhbGciOiJIUzI1NiJ9',
      'person@example.com',
      'https:private.example',
    ]) {
      expect(sanitizeExtensionOperationalEvent({
        event: 'bridge.request',
        outcome: 'failure',
        releaseRevision: 'rc1',
        extensionId: leakedIdentifier,
      })).toBeNull();
      expect(sanitizeExtensionOperationalEvent({
        event: 'bridge.request',
        outcome: 'failure',
        releaseRevision: leakedIdentifier,
      })).toBeNull();
      expect(sanitizeExtensionOperationalEvent({
        event: 'bridge.request',
        outcome: 'failure',
        releaseRevision: 'rc1',
        errorClass: leakedIdentifier,
      })).toBeNull();
    }
  });

  it('drops arbitrary extension logs and forwards one sanitized event', () => {
    const sink = vi.fn();
    const telemetry = createPrivacySafeExtensionTelemetryHost(sink);
    telemetry.log('caption text', { projectId: 'private' });
    telemetry.error(new Error('contains a path'));
    telemetry.log({ event: 'host.activation', outcome: 'success', releaseRevision: 'rc1' });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({ event: 'host.activation', outcome: 'success', releaseRevision: 'rc1' });
  });

  it('contains hostile payloads and a failing analytics sink', () => {
    const payload = Object.defineProperty({}, 'event', {
      enumerable: true,
      get: () => { throw new Error('hostile getter'); },
    });
    expect(sanitizeExtensionOperationalEvent(payload)).toBeNull();

    const telemetry = createPrivacySafeExtensionTelemetryHost(() => {
      throw new Error('analytics unavailable');
    });
    expect(() => telemetry.log({
      event: 'host.activation',
      outcome: 'success',
      releaseRevision: 'rc1',
    })).not.toThrow();
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
    }], 'rc1')).toEqual([expect.objectContaining({
      event: 'extension.activation',
      outcome: 'success',
    })]);
    expect(buildExtensionLifecycleOperationalEvents(active, [{
      ...active[0],
      state: 'failed',
    }], 'rc1')).toEqual([expect.objectContaining({
      event: 'extension.activation',
      outcome: 'failure',
      errorClass: 'activation.error',
    })]);
    expect(buildExtensionLifecycleOperationalEvents(active, [], 'rc1')).toEqual([{
      event: 'extension.disposal',
      outcome: 'success',
      releaseRevision: 'rc1',
      extensionId: 'com.reigh.example',
      extensionVersion: '1.0.0',
    }]);
  });
});
