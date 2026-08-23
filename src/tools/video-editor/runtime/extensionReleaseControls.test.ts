import { describe, expect, it, vi } from 'vitest';
import { defineExtension } from '@reigh/editor-sdk';
import {
  buildExtensionLifecycleOperationalEvents,
  createPrivacySafeExtensionTelemetryHost,
  RUNAWAY_RELEASE_EXTENSION_ID,
  TRANSCRIPT_RELEASE_EXTENSION_ID,
  resolveExtensionReleaseFlags,
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

  it('defaults closed in production and open in development', () => {
    expect(resolveExtensionReleaseFlags({}, { development: false })).toMatchObject({
      extensionHostEnabled: false,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: false,
    });
    expect(resolveExtensionReleaseFlags({}, { development: true })).toMatchObject({
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: true,
      runawayTypedTimelineEnabled: true,
    });
  });

  it('enforces the host parent and exact deployment values', () => {
    expect(resolveExtensionReleaseFlags({
      VITE_EXTENSION_HOST_ENABLED: 'false',
      VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
      VITE_RUNAWAY_TYPED_TIMELINE_ENABLED: '1',
    }, { development: true })).toEqual({
      extensionHostEnabled: false,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: false,
      configurationRevision: 'unset',
    });
    expect(resolveExtensionReleaseFlags({
      VITE_EXTENSION_HOST_ENABLED: 'true',
      VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'false',
      VITE_RUNAWAY_TYPED_TIMELINE_ENABLED: '1',
      VITE_EXTENSION_RELEASE_CONFIG_REVISION: 'rc1-canary.3',
    }, { development: false })).toEqual({
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: true,
      configurationRevision: 'rc1-canary.3',
    });
    expect(resolveExtensionReleaseFlags({
      VITE_EXTENSION_HOST_ENABLED: 'true',
      VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
    }, { development: false })).toMatchObject({
      extensionHostEnabled: false,
      transcriptCaptionFoundryEnabled: false,
      configurationRevision: 'unset',
    });
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
