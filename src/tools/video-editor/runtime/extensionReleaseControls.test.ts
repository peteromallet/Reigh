import { describe, expect, it, vi } from 'vitest';
import { defineExtension } from '@reigh/editor-sdk';
import {
  createPrivacySafeExtensionTelemetryHost,
  resolveExtensionReleaseFlags,
  sanitizeExtensionOperationalEvent,
  selectReleaseEnabledExtensions,
} from './extensionReleaseControls';

const extension = (id: string) => defineExtension({
  manifest: { id: id as never, version: '1.0.0', apiVersion: 1, license: 'MIT', label: id },
});

describe('extension release controls', () => {
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
      extension('com.reigh.transcript-lane'),
      extension('com.reigh.runaway-timeline'),
    ];
    expect(selectReleaseEnabledExtensions(all, {
      extensionHostEnabled: true,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: true,
      configurationRevision: 'r1',
    }).map((item) => item.manifest.id)).toEqual([
      'com.reigh.creative',
      'com.reigh.runaway-timeline',
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
});
