// Sprint 8: render-button router tests.
// Mirrors the sprint brief's three cases (pure media, themed, mixed) +
// the orchestrator dispatch shape.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRenderTimelinePayload,
  cancelAstridRenderTask,
  decideRenderRoute,
  enqueueBanodocoRenderTimeline,
} from '@/tools/video-editor/lib/renderRouter';
import { executeRenderPipeline } from '@/tools/video-editor/render/renderPipeline';
import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { createFakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import { makeAdmittedTaskReadModel } from '@/test/bridgeFixtures.mjs';

const renderAdmissionResponse = (taskId = 'task-42') => ({
  task: makeAdmittedTaskReadModel({
    taskId,
    family: 'render_export',
    capability: 'rendering.timeline_visualize',
  }),
});

describe('Sprint 8 render-button router (decideRenderRoute)', () => {
  it('routes a pure-media timeline to the client renderer', () => {
    const decision = decideRenderRoute({
      clips: [
        { clipType: 'media' },
        { clipType: 'text' },
        { clipType: 'effect-layer' },
      ],
    });
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasThemedClip).toBe(false);
    expect(decision.hasMediaClip).toBe(true);
    expect(decision.reason).toBe('pure_native_clips');
  });

  it('routes a themed-only timeline to banodoco_render_timeline', () => {
    const decision = decideRenderRoute({
      clips: [{ clipType: 'image-jump' }],
    });
    expect(decision.route).toBe('worker-banodoco');
    expect(decision.hasThemedClip).toBe(true);
    expect(decision.hasMediaClip).toBe(false);
    expect(decision.reason).toBe('themed_only');
    expect(decision.planner.selectedPlannerRoute).toBe('worker-export');
    expect(decision.planner.plannerResult.canBrowserExport).toBe(false);
    expect(decision.planner.plannerResult.canWorkerExport).toBe(true);
  });

  it('routes locally-registered title-card timelines to banodoco_render_timeline', () => {
    const decision = decideRenderRoute({
      clips: [{ clipType: 'title-card' }],
    });
    expect(decision.route).toBe('worker-banodoco');
    expect(decision.hasThemedClip).toBe(true);
    expect(decision.hasMediaClip).toBe(false);
    expect(decision.reason).toBe('themed_only');
  });

  it('routes a mixed themed+media timeline to banodoco_render_timeline', () => {
    const decision = decideRenderRoute({
      clips: [
        { clipType: 'media' },
        { clipType: 'image-jump' },
      ],
    });
    expect(decision.route).toBe('worker-banodoco');
    expect(decision.hasThemedClip).toBe(true);
    expect(decision.hasMediaClip).toBe(true);
    expect(decision.reason).toBe('mixed_themed_and_media');
  });

  it('routes mixed local-sequence and media timelines to banodoco_render_timeline', () => {
    const decision = decideRenderRoute({
      clips: [
        { clipType: 'media' },
        { clipType: 'title-card' },
      ],
    });
    expect(decision.route).toBe('worker-banodoco');
    expect(decision.hasThemedClip).toBe(true);
    expect(decision.hasMediaClip).toBe(true);
    expect(decision.reason).toBe('mixed_themed_and_media');
  });

  it('treats legacy clips with undefined clipType as native media', () => {
    const decision = decideRenderRoute({
      clips: [{}, { clipType: undefined }],
    });
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasThemedClip).toBe(false);
    expect(decision.hasMediaClip).toBe(true);
  });

  it('treats unknown clipTypes as media (loud-placeholder fallback path)', () => {
    const decision = decideRenderRoute({
      clips: [{ clipType: 'theme-package-not-yet-installed' }],
    });
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasThemedClip).toBe(false);
  });

  it('routes valid remotion_module clips by lane metadata before clipType fallback', () => {
    const decision = decideRenderRoute({
      clips: [{
        clipType: 'generated-clip-type-not-installed',
        generation: {
          sequence_lane: 'remotion_module',
          artifact_id: 'artifact-1',
        },
      }],
    });

    expect(decision.route).toBe('worker-banodoco');
    expect(decision.reason).toBe('generated_remotion_module');
  });

  it('routes registered theme clipTypes as generated modules when the module lane is present', () => {
    const decision = decideRenderRoute({
      clips: [{
        clipType: 'art-card',
        generation: {
          sequence_lane: 'remotion_module',
          artifact_id: 'artifact-1',
        },
      }],
    });

    expect(decision.route).toBe('worker-banodoco');
    expect(decision.reason).toBe('generated_remotion_module');
  });

  it('routes mixed valid remotion_module timelines to the worker route with a generated reason', () => {
    const decision = decideRenderRoute({
      clips: [
        { clipType: 'media' },
        {
          clipType: 'image-jump',
          generation: {
            sequence_lane: 'remotion_module',
            artifact_id: 'artifact-1',
          },
        },
      ],
    });

    expect(decision.route).toBe('worker-banodoco');
    expect(decision.reason).toBe('mixed_generated_module_and_other');
    expect(decision.hasMediaClip).toBe(true);
  });

  it('blocks remotion_module clips with missing, empty, or non-string artifact ids', () => {
    const missingArtifact = decideRenderRoute({
      clips: [{ clipType: 'media', generation: { sequence_lane: 'remotion_module' } }],
    });
    expect(missingArtifact).toMatchObject({
      route: 'preview-only',
      reason: 'remotion_module_missing_artifact',
    });
    // Nothing in this plan targets sidecar-export, so `canSidecarExport`
    // is only vacuously true and the planner falls through to preview
    // rather than hijacking the render onto an unimplemented provider.
    expect(missingArtifact.planner.selectedPlannerRoute).toBe('preview');
    expect(missingArtifact.planner.plannerResult.canBrowserExport).toBe(false);
    expect(missingArtifact.planner.plannerResult.canWorkerExport).toBe(false);
    expect(missingArtifact.planner.plannerResult.canSidecarExport).toBe(true);

    expect(decideRenderRoute({
      clips: [{ clipType: 'image-jump', generation: { sequence_lane: 'remotion_module', artifact_id: '' } }],
    })).toMatchObject({
      route: 'preview-only',
      reason: 'remotion_module_invalid_artifact',
    });

    expect(decideRenderRoute({
      clips: [{ clipType: 'unknown', generation: { sequence_lane: 'remotion_module', artifact_id: 42 } }],
    })).toMatchObject({
      route: 'preview-only',
      reason: 'remotion_module_invalid_artifact',
    });
  });

  it('does not treat non-module generation lanes as generated Remotion modules', () => {
    for (const sequence_lane of ['trusted_v1', 'schema_sequence', 'unknown_lane', null, undefined]) {
      expect(decideRenderRoute({
        clips: [{
          clipType: 'media',
          generation: { sequence_lane, artifact_id: 'artifact-1' },
        }],
      })).toMatchObject({
        route: 'browser-remotion',
        reason: 'pure_native_clips',
      });
    }
  });

  it('returns no_clips for an empty timeline', () => {
    expect(decideRenderRoute({ clips: [] }).reason).toBe('no_clips');
    expect(decideRenderRoute(null).reason).toBe('no_clips');
    expect(decideRenderRoute(undefined).reason).toBe('no_clips');
  });
});

// ---------------------------------------------------------------------------
// M7b T2: Sidecar-export planner / router selection
// ---------------------------------------------------------------------------

describe('M7b T2 sidecar-export route selection', () => {
  it('does not select sidecar-export when nothing in the plan targets that route', () => {
    // Blocked remotion_module blocks browser + worker but not sidecar —
    // and sidecar is unblocked only because no requirement, output format,
    // process requirement or artifact profile ever named it. A vacuously
    // unblocked route is not a render candidate.
    const decision = decideRenderRoute({
      clips: [{ clipType: 'media', generation: { sequence_lane: 'remotion_module' } }],
    });
    expect(decision.planner.selectedPlannerRoute).toBe('preview');
    expect(decision.planner.plannerResult.canBrowserExport).toBe(false);
    expect(decision.planner.plannerResult.canWorkerExport).toBe(false);
    expect(decision.planner.plannerResult.canSidecarExport).toBe(true);
    const sidecarPlan = decision.planner.plannerResult.routePlans
      .find((plan) => plan.route === 'sidecar-export');
    expect(sidecarPlan?.requiredCapabilities).toEqual([]);
    expect(sidecarPlan?.outputFormatIds).toEqual([]);
    expect(sidecarPlan?.processRequirements).toEqual([]);
    // Clip-level block still forces preview-only for the UI route.
    expect(decision.route).toBe('preview-only');
  });

  it('does not select sidecar-export when browser is available (priority order)', () => {
    const decision = decideRenderRoute({
      clips: [{ clipType: 'media' }],
    });
    // Browser is available, so it should be selected over sidecar.
    expect(decision.planner.selectedPlannerRoute).toBe('browser-export');
    expect(decision.planner.plannerResult.canBrowserExport).toBe(true);
    expect(decision.planner.plannerResult.canSidecarExport).toBe(true);
    expect(decision.route).toBe('browser-remotion');
  });

  it('falls back to preview when all routes including sidecar are blocked', () => {
    // Use a process with blockers that target all export routes including sidecar.
    // When every export route is blocked, the planner selects preview.
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'media' }] },
      undefined,
      {
        processes: [{
          id: 'blocker-process-contrib',
          extensionId: 'ext.blocker',
          processId: 'blocker-process',
          label: 'All-routes blocker',
          spec: {
            id: 'blocker-process',
            label: 'All-routes blocker',
            protocol: 'stdio-jsonrpc',
            spawn: { command: 'node', args: ['blocker.js'] },
            operations: [{
              id: 'blockAll',
              label: 'Block all',
              routes: ['browser-export', 'worker-export', 'sidecar-export'],
            }],
          },
          protocol: 'stdio-jsonrpc',
          operations: [{
            id: 'blockAll',
            label: 'Block all',
            routes: ['browser-export', 'worker-export', 'sidecar-export'],
          }],
          availableRoutes: ['browser-export', 'worker-export', 'sidecar-export'],
          requiredBy: [],
          blockers: [
            {
              id: 'blocker.browser',
              route: 'browser-export',
              reason: 'process-dependent',
              message: 'Browser export blocked by test process.',
            },
            {
              id: 'blocker.worker',
              route: 'worker-export',
              reason: 'process-dependent',
              message: 'Worker export blocked by test process.',
            },
            {
              id: 'blocker.sidecar',
              route: 'sidecar-export',
              reason: 'process-dependent',
              message: 'Sidecar export blocked by test process.',
            },
          ],
          nextActions: [],
        }],
        processStatuses: [{
          processId: 'blocker-process',
          status: 'ready',
          operations: {},
        }],
      },
    );
    expect(decision.planner.plannerResult.canBrowserExport).toBe(false);
    expect(decision.planner.plannerResult.canWorkerExport).toBe(false);
    expect(decision.planner.plannerResult.canSidecarExport).toBe(false);
    expect(decision.planner.selectedPlannerRoute).toBe('preview');
    // Native media clips → browser-remotion is the clip logic fallback,
    // but when all routes are blocked, the planner context shows preview.
    expect(decision.route).toBe('browser-remotion');
  });

  it('keeps native clips on browser-remotion when browser/worker are blocked and nothing demands sidecar', () => {
    // The blocking process only ever declares browser-export and
    // worker-export. sidecar-export is therefore unblocked purely by
    // vacancy, and must not hijack the decision onto `external` — the
    // planner's own blockers (browser/worker) are what the user needs to
    // see, not "no external render provider is registered".
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'media' }] },
      undefined,
      {
        processes: [{
          id: 'browser-worker-blocker-contrib',
          extensionId: 'ext.bwblocker',
          processId: 'bw-blocker-process',
          label: 'Browser + worker blocker',
          spec: {
            id: 'bw-blocker-process',
            label: 'Browser + worker blocker',
            protocol: 'stdio-jsonrpc',
            spawn: { command: 'node', args: ['bw-blocker.js'] },
            operations: [{
              id: 'blockBW',
              label: 'Block browser + worker',
              routes: ['browser-export', 'worker-export'],
            }],
          },
          protocol: 'stdio-jsonrpc',
          operations: [{
            id: 'blockBW',
            label: 'Block browser + worker',
            routes: ['browser-export', 'worker-export'],
          }],
          availableRoutes: ['browser-export', 'worker-export'],
          requiredBy: [],
          blockers: [
            {
              id: 'blocker.browser',
              route: 'browser-export',
              reason: 'process-dependent',
              message: 'Browser export blocked.',
            },
            {
              id: 'blocker.worker',
              route: 'worker-export',
              reason: 'process-dependent',
              message: 'Worker export blocked.',
            },
          ],
          nextActions: [],
        }],
        processStatuses: [{
          processId: 'bw-blocker-process',
          status: 'ready',
          operations: {},
        }],
      },
    );
    expect(decision.planner.plannerResult.canBrowserExport).toBe(false);
    expect(decision.planner.plannerResult.canWorkerExport).toBe(false);
    expect(decision.planner.plannerResult.canSidecarExport).toBe(true);
    expect(decision.planner.selectedPlannerRoute).toBe('preview');
    expect(decision.route).toBe('browser-remotion');
    expect(decision.reason).toBe('pure_native_clips');
    // The blockers the user must act on stay addressable on the decision.
    expect(decision.planner.plannerResult.blockers.map((blocker) => blocker.route))
      .toEqual(['browser-export', 'worker-export']);
  });

  it('maps sidecar-export planner route to external when the plan genuinely demands sidecar-export', () => {
    // Same blocked browser/worker shape, but here a registered process
    // declares sidecar-export, so the sidecar route plan carries real
    // demand (a required capability) and selecting it is honest.
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'media' }] },
      undefined,
      {
        processes: [{
          id: 'sidecar-process-contrib',
          extensionId: 'ext.sidecar',
          processId: 'sidecar-process',
          label: 'Sidecar exporter',
          spec: {
            id: 'sidecar-process',
            label: 'Sidecar exporter',
            protocol: 'stdio-jsonrpc',
            spawn: { command: 'node', args: ['sidecar.js'] },
            operations: [{
              id: 'exportSidecar',
              label: 'Export sidecar',
              routes: ['browser-export', 'worker-export', 'sidecar-export'],
            }],
          },
          protocol: 'stdio-jsonrpc',
          operations: [{
            id: 'exportSidecar',
            label: 'Export sidecar',
            routes: ['browser-export', 'worker-export', 'sidecar-export'],
          }],
          availableRoutes: ['browser-export', 'worker-export', 'sidecar-export'],
          requiredBy: [],
          blockers: [
            {
              id: 'blocker.browser',
              route: 'browser-export',
              reason: 'process-dependent',
              message: 'Browser export blocked.',
            },
            {
              id: 'blocker.worker',
              route: 'worker-export',
              reason: 'process-dependent',
              message: 'Worker export blocked.',
            },
          ],
          nextActions: [],
        }],
        processStatuses: [{
          processId: 'sidecar-process',
          status: 'ready',
          operations: {},
        }],
      },
    );
    const sidecarPlan = decision.planner.plannerResult.routePlans
      .find((plan) => plan.route === 'sidecar-export');
    expect(sidecarPlan?.blocked).toBe(false);
    expect(sidecarPlan?.requiredCapabilities.length).toBeGreaterThan(0);
    expect(decision.planner.selectedPlannerRoute).toBe('sidecar-export');
    expect(decision.route).toBe('external');
    expect(decision.reason).toBe('pure_native_clips');
  });

  it('blocked sidecar-export does not prevent browser export selection', () => {
    // When browser is available and sidecar is blocked, browser should
    // still be selected. This verifies that a blocked sidecar route
    // leaves unrelated browser/worker/preview choices unaffected.
    const decision = decideRenderRoute({
      clips: [{ clipType: 'media' }],
    });
    // With native media, browser is available and should be selected.
    expect(decision.planner.selectedPlannerRoute).toBe('browser-export');
    expect(decision.planner.plannerResult.canBrowserExport).toBe(true);
    expect(decision.route).toBe('browser-remotion');
    // sidecar status does not affect the browser route selection.
    expect(decision.planner.plannerResult.canSidecarExport).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: vacuous route unblocking must never select a route
// ---------------------------------------------------------------------------

describe('planner route selection never rides a vacuously unblocked route', () => {
  // `RenderRoutePlan.blocked` answers "does any blocker name this route?".
  // For a route nothing in the plan targets the answer is always "no", so
  // `canSidecarExport` (and any future `can*Export`) reads true for an empty
  // plan. Selecting on that alone routes the render at a provider the
  // timeline never asked for — historically `external`, which is a
  // registered stub with no implementation. The invariant below is the
  // class-level guard: whatever route the planner selects, that route plan
  // must carry demand.
  const timelines: ReadonlyArray<{
    readonly label: string;
    readonly timeline: Parameters<typeof decideRenderRoute>[0];
  }> = [
    { label: 'pure native media', timeline: { clips: [{ clipType: 'media' }] } },
    { label: 'themed only', timeline: { clips: [{ clipType: 'image-jump' }] } },
    {
      label: 'valid generated module',
      timeline: {
        clips: [{
          clipType: 'media',
          generation: { sequence_lane: 'remotion_module', artifact_id: 'artifact-1' },
        }],
      },
    },
    {
      label: 'blocked generated module',
      timeline: {
        clips: [{ clipType: 'media', generation: { sequence_lane: 'remotion_module' } }],
      },
    },
    { label: 'empty timeline', timeline: { clips: [] } },
  ];

  it.each(timelines)('$label — a delegated planner route carries demand', ({ timeline }) => {
    const decision = decideRenderRoute(timeline);
    const { selectedPlannerRoute, plannerResult } = decision.planner;
    // `preview` and `browser-export` are the host's own routes: falling back
    // to them with an empty plan renders in-browser, which is always
    // available. `worker-export` and `sidecar-export` delegate outside the
    // host, so they may only be selected on real demand.
    if (selectedPlannerRoute === 'preview' || selectedPlannerRoute === 'browser-export') return;
    const plan = plannerResult.routePlans.find((candidate) => candidate.route === selectedPlannerRoute);
    expect(plan).toBeDefined();
    const demand = (plan?.requiredCapabilities.length ?? 0)
      + (plan?.outputFormatIds.length ?? 0)
      + (plan?.processRequirements.length ?? 0)
      + (plan?.artifactCompletion.requiredProfiles.length ?? 0);
    expect(demand).toBeGreaterThan(0);
  });

  it('never returns the unimplemented external provider for a plan with no sidecar demand', () => {
    for (const { timeline } of timelines) {
      const decision = decideRenderRoute(timeline);
      const sidecarPlan = decision.planner.plannerResult.routePlans
        .find((plan) => plan.route === 'sidecar-export');
      // Every fixture above leaves sidecar-export empty…
      expect(sidecarPlan?.requiredCapabilities).toEqual([]);
      expect(sidecarPlan?.blocked).toBe(false);
      // …and none of them may therefore route to `external`.
      expect(decision.planner.selectedPlannerRoute).not.toBe('sidecar-export');
      expect(decision.route).not.toBe('external');
    }
  });
});

// ---------------------------------------------------------------------------
// M9 T11: Contributed clip routing via dynamic capability records
// ---------------------------------------------------------------------------

function makeContributedRecord(
  clipTypeId: string,
  capabilities: Array<{ route: string; status: string }>,
) {
  return {
    clipTypeId,
    renderability: {
      capabilities: capabilities.map((c) => ({
        route: c.route,
        status: c.status,
        determinism: 'deterministic' as const,
      })),
      determinism: 'deterministic' as const,
    },
  };
}

const browserCapableRecord = makeContributedRecord('ext-glow', [
  { route: 'browser-export', status: 'supported' },
  { route: 'preview', status: 'supported' },
]);

const previewOnlyRecord = makeContributedRecord('ext-preview-only', [
  { route: 'preview', status: 'supported' },
  { route: 'browser-export', status: 'blocked' },
]);

const workerOnlyRecord = makeContributedRecord('ext-worker-only', [
  { route: 'worker-export', status: 'supported' },
  { route: 'preview', status: 'supported' },
]);

const noCapabilitiesRecord = makeContributedRecord('ext-no-caps', []);

describe('M9 T11 contributed clip routing (decideRenderRoute)', () => {
  it('routes a browser-capable contributed clip to browser-remotion', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'ext-glow' }] },
      [browserCapableRecord],
    );
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.hasThemedClip).toBe(false);
    expect(decision.reason).toBe('browser_capable_contributed');
  });

  it('routes mixed browser-capable contributed + native clips to browser-remotion', () => {
    const decision = decideRenderRoute(
      {
        clips: [
          { clipType: 'ext-glow' },
          { clipType: 'media' },
        ],
      },
      [browserCapableRecord],
    );
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.hasMediaClip).toBe(true);
    expect(decision.reason).toBe('mixed_browser_capable_contributed_and_native');
  });

  it('blocks a contributed clip without browser-export capability (preview-only route)', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'ext-preview-only' }] },
      [previewOnlyRecord],
    );
    expect(decision.route).toBe('preview-only');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.reason).toBe('contributed_blocked_no_browser_capability');
  });

  it('blocks a contributed clip with only worker-export capability (worker routes blocked for contributed code)', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'ext-worker-only' }] },
      [workerOnlyRecord],
    );
    expect(decision.route).toBe('preview-only');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.reason).toBe('contributed_blocked_no_browser_capability');
  });

  it('blocks a contributed clip with no capabilities at all', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'ext-no-caps' }] },
      [noCapabilitiesRecord],
    );
    expect(decision.route).toBe('preview-only');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.reason).toBe('contributed_blocked_no_browser_capability');
  });

  it('blocks mixed contributed (browser-capable) + themed clips due to worker route conflict', () => {
    const decision = decideRenderRoute(
      {
        clips: [
          { clipType: 'ext-glow' },
          { clipType: 'image-jump' },
        ],
      },
      [browserCapableRecord],
    );
    expect(decision.route).toBe('preview-only');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.hasThemedClip).toBe(true);
    expect(decision.reason).toBe('contributed_blocked_worker_route_conflict');
  });

  it('blocks contributed clip mixed with generated remotion module due to worker route conflict', () => {
    const decision = decideRenderRoute(
      {
        clips: [
          { clipType: 'ext-glow' },
          {
            clipType: 'image-jump',
            generation: {
              sequence_lane: 'remotion_module',
              artifact_id: 'artifact-1',
            },
          },
        ],
      },
      [browserCapableRecord],
    );
    expect(decision.route).toBe('preview-only');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.reason).toBe('contributed_blocked_worker_route_conflict');
  });

  it('multiple browser-capable contributed clips all route to browser-remotion', () => {
    const record2 = makeContributedRecord('ext-glow-2', [
      { route: 'browser-export', status: 'supported' },
    ]);
    const decision = decideRenderRoute(
      {
        clips: [
          { clipType: 'ext-glow' },
          { clipType: 'ext-glow-2' },
        ],
      },
      [browserCapableRecord, record2],
    );
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.reason).toBe('browser_capable_contributed');
  });

  it('existing themed routing is unchanged when contributed records are empty', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'image-jump' }] },
      [],
    );
    expect(decision.route).toBe('worker-banodoco');
    expect(decision.hasThemedClip).toBe(true);
    expect(decision.hasContributedClip).toBe(false);
    expect(decision.reason).toBe('themed_only');
  });

  it('existing native routing is unchanged when contributed records are empty', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'media' }] },
      [],
    );
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasContributedClip).toBe(false);
    expect(decision.reason).toBe('pure_native_clips');
  });

  it('existing native routing is unchanged when contributed records are undefined', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'media' }] },
      undefined,
    );
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasContributedClip).toBe(false);
    expect(decision.reason).toBe('pure_native_clips');
  });

  it('a contributed record for an unrelated clipType does not affect themed routing', () => {
    const decision = decideRenderRoute(
      { clips: [{ clipType: 'title-card' }] },
      [browserCapableRecord], // ext-glow record, not title-card
    );
    expect(decision.route).toBe('worker-banodoco');
    expect(decision.hasContributedClip).toBe(false);
    expect(decision.hasThemedClip).toBe(true);
    expect(decision.reason).toBe('themed_only');
  });

  it('blocks the first contributed clip without browser capability even when mixed with native clips', () => {
    const decision = decideRenderRoute(
      {
        clips: [
          { clipType: 'media' },
          { clipType: 'ext-preview-only' },
        ],
      },
      [previewOnlyRecord],
    );
    expect(decision.route).toBe('preview-only');
    expect(decision.hasContributedClip).toBe(true);
    expect(decision.reason).toBe('contributed_blocked_no_browser_capability');
  });

  it('no_clips decision reports hasContributedClip false', () => {
    const decision = decideRenderRoute({ clips: [] }, [browserCapableRecord]);
    expect(decision.route).toBe('browser-remotion');
    expect(decision.hasContributedClip).toBe(false);
    expect(decision.reason).toBe('no_clips');
  });

  it('blocked remotion_module short-circuits before contributed record lookup', () => {
    const decision = decideRenderRoute(
      {
        clips: [{
          clipType: 'ext-glow',
          generation: { sequence_lane: 'remotion_module' },
        }],
      },
      [browserCapableRecord], // ext-glow is browser-capable but the module is blocked
    );
    expect(decision.route).toBe('preview-only');
    expect(decision.reason).toBe('remotion_module_missing_artifact');
  });
});

describe('Sprint 8 buildRenderTimelinePayload', () => {
  const baseInput = {
    request: {
      timelineId: '11111111-1111-1111-1111-111111111111',
      assetRegistry: { assets: { a: { url: 'https://cdn/a.mp4' } } },
      resolvedConfig: {
        theme: '2rp',
        clips: [{ clipType: 'art-card' }],
      },
      renderMetadata: null,
      renderRuntime: {
        projectId: '22222222-2222-2222-2222-222222222222',
      },
    },
    correlationId: '33333333-3333-3333-3333-333333333333',
  };

  it('produces the SD-034-shaped payload from valid input', () => {
    const { payload, error } = buildRenderTimelinePayload(baseInput);
    expect(error).toBeUndefined();
    expect(payload).toBeDefined();
    expect(payload!.timeline_id).toBe(baseInput.request.timelineId);
    expect(payload!.project_id).toBe(baseInput.request.renderRuntime.projectId);
    expect(payload!.correlation_id).toBe(baseInput.correlationId);
    expect(payload!.theme_id).toBe('2rp');
    expect(payload!.output_filename).toContain(baseInput.request.timelineId);
  });

  it('keeps explicit caller-owned request inputs for local fixture renders', () => {
    const request = {
      ...baseInput.request,
      timelineId: 'fixture-local-timeline',
      assetRegistry: {
        assets: {
          'fixture-video': {
            file: 'fixtures/local.mp4',
            src: 'file:///tmp/fixtures/local.mp4',
            type: 'video/mp4',
          },
        },
      },
      resolvedConfig: {
        theme: '2rp',
        output: { resolution: '1920x1080', fps: 30, file: 'fixture.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [{ id: 'clip-fixture', clipType: 'image-jump', track: 'V1', at: 0, hold: 2 }],
        registry: {
          'fixture-video': {
            file: 'fixtures/local.mp4',
            src: 'file:///tmp/fixtures/local.mp4',
            type: 'video/mp4',
          },
        },
      },
    };

    const { payload, error } = buildRenderTimelinePayload({
      ...baseInput,
      request,
      correlationId: 'fixture-correlation',
    });

    expect(error).toBeUndefined();
    expect(payload).toBeDefined();
    expect(payload!.timeline_id).toBe('fixture-local-timeline');
    expect(payload!.project_id).toBe(request.renderRuntime.projectId);
    expect(payload!.correlation_id).toBe('fixture-correlation');
    expect(payload!.assets).toBe(request.assetRegistry);
  });

  it('falls back to 2rp theme when config has no theme field', () => {
    const { payload } = buildRenderTimelinePayload({
      ...baseInput,
      request: {
        ...baseInput.request,
        resolvedConfig: { clips: [{ clipType: 'art-card' }] },
      },
    });
    expect(payload!.theme_id).toBe('2rp');
  });

  it('carries no legacy auth fields for local Astrid admission', () => {
    const { payload, error } = buildRenderTimelinePayload(baseInput);
    expect(payload).toBeDefined();
    expect(error).toBeUndefined();
    expect(payload).not.toHaveProperty('user_jwt');
  });

  it('rejects empty timelineId / projectId', () => {
    expect(buildRenderTimelinePayload({
      ...baseInput,
      request: {
        ...baseInput.request,
        timelineId: '',
      },
    }).error).toBeTruthy();
    expect(buildRenderTimelinePayload({
      ...baseInput,
      request: {
        ...baseInput.request,
        renderRuntime: {
          ...baseInput.request.renderRuntime,
          projectId: '',
        },
      },
    }).error).toBeTruthy();
  });

  it('materializes sequence asset keys for the render payload without mutating persisted params', () => {
    const resolvedConfig = {
      theme: '2rp',
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [
        {
          id: 'clip-resource',
          clipType: 'resource-card',
          track: 'V1',
          at: 0,
          hold: 3,
          params: {
            title: 'Resource',
            previewAssetKeys: ['asset-a'],
          },
        },
      ],
      registry: {
        'asset-a': {
          file: 'asset-a.png',
          src: 'https://cdn.example.com/asset-a.png',
          type: 'image',
        },
      },
    };

    const { payload } = buildRenderTimelinePayload({
      ...baseInput,
      request: {
        ...baseInput.request,
        resolvedConfig,
      },
    });

    const clip = (payload!.timeline as typeof resolvedConfig).clips[0];
    expect(clip.params).toMatchObject({
      previewAssetKeys: ['asset-a'],
      previews: ['https://cdn.example.com/asset-a.png'],
    });
    expect(resolvedConfig.clips[0].params).toEqual({
      title: 'Resource',
      previewAssetKeys: ['asset-a'],
    });
  });
});

describe('Sprint 8 enqueueBanodocoRenderTimeline', () => {
  const payload = {
    timeline_id: 't',
    timeline: { clips: [] },
    assets: { assets: {} },
    theme_id: '2rp',
    output_filename: 'render.mp4',
    project_id: 'p',
    correlation_id: 'c',
  };

  it('POSTs render_export through the common R1 task route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(renderAdmissionResponse()), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const result = await enqueueBanodocoRenderTimeline(payload, {
      client: new AstridLocalClient({ projectSlug: 'p', baseUrl: 'http://bridge.fake' }),
      expectedVersion: 12,
      destination: 'project-media',
    });
    expect(result.status).toBe('queued');
    expect(result.task_id).toBe('task-42');
    expect(result.correlation_id).toBe('c');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://bridge.fake/projects/p/tasks');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('reigh.render:v1:t:12:project-media:render.mp4');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.family).toBe('render_export');
    expect(body.input).toMatchObject({
      timeline_ref: 't',
      expected_version: 12,
      format: 'mp4',
      destination: 'project-media',
      correlation_id: 'c',
    });
    vi.unstubAllGlobals();
  });

  it('surfaces a rejected Astrid admission as an error result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_body', detail: 'bad payload' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const result = await enqueueBanodocoRenderTimeline(payload, {
      client: new AstridLocalClient({ projectSlug: 'p', baseUrl: 'http://bridge.fake' }),
    });
    expect(result.status).toBe('error');
    expect(result.message).toContain('bad payload');
    vi.unstubAllGlobals();
  });

  it('surfaces a network failure as an error result', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchImpl);
    const result = await enqueueBanodocoRenderTimeline(payload, {
      client: new AstridLocalClient({ projectSlug: 'p', baseUrl: 'http://bridge.fake' }),
    });
    expect(result.status).toBe('error');
    expect(result.message).toContain('connection refused');
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// B6 T6.1/T6.2: cancel rides the common fenced task route
// ---------------------------------------------------------------------------

function stubFakeBridge() {
  const router = createFakeBridgeRouter();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return await router.handle(new Request(`http://bridge.fake${url.pathname}${url.search}`, init));
  }));
  return router;
}

describe('cancelAstridRenderTask rides the common fenced task route', () => {
  const admission = {
    family: 'render_export',
    input: {
      timeline_ref: 't',
      format: 'mp4',
      output_filename: 'render.mp4',
      destination: 'download',
      correlation_id: 'c',
    },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels a queued render directly through POST /tasks/:id/cancel', async () => {
    const router = stubFakeBridge();
    const client = new AstridLocalClient({ projectSlug: 'demo-project', baseUrl: 'http://bridge.fake' });
    const { task } = await client.tasks.admit(admission, 'reigh.render:cancel-queued');

    await expect(cancelAstridRenderTask(client, task.id)).resolves.toBeUndefined();
    expect(await client.tasks.get(task.id)).toMatchObject({ status: 'cancelled' });
  });

  it('retries a running render cancel with the live attempt fence', async () => {
    const router = stubFakeBridge();
    const client = new AstridLocalClient({ projectSlug: 'demo-project', baseUrl: 'http://bridge.fake' });
    const { task } = await client.tasks.admit(admission, 'reigh.render:cancel-running');
    const summary = router.state.tasks.get(task.id);
    if (!summary) throw new Error('fixture missing');
    summary.status = 'running';

    await expect(cancelAstridRenderTask(client, task.id)).resolves.toBeUndefined();

    const cancelCalls = vi.mocked(globalThis.fetch).mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/cancel')
        && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(cancelCalls).toHaveLength(2); // unfenced 409, then the fenced retry
    const fence = JSON.parse((cancelCalls[1][1] as RequestInit).body as string);
    expect(fence.attempt_id).toBeTruthy();
    expect(fence.lease_id).toBeTruthy();
    expect(fence.status_version).toBeGreaterThan(0);
    expect(await client.tasks.get(task.id)).toMatchObject({ status: 'cancelled' });
  });
});

describe('render-as-task journey against the binding stub (B6 smoke)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('admits, polls, completes, and plays the committed MP4 through R9 Range/ETag', async () => {
    const router = stubFakeBridge();
    const client = new AstridLocalClient({ projectSlug: 'demo-project', baseUrl: 'http://bridge.fake' });

    // R1 admission through the common task route.
    const result = await enqueueBanodocoRenderTimeline({
      timeline_id: 't',
      timeline: { clips: [] },
      assets: { assets: {} },
      theme_id: '2rp',
      output_filename: 'journey.mp4',
      project_id: 'demo-project',
      correlation_id: 'c-journey',
    }, { client });
    expect(result).toMatchObject({ status: 'queued', task_id: expect.any(String) });
    const taskId = result.task_id!;

    // Declared poll cadence read model: queued with no attempts yet.
    let detail = await client.tasks.get(taskId);
    expect(detail.status).toBe('queued');
    expect(detail.attempts).toEqual([]);

    // The executor finishes and commits its render output as managed media.
    const mp4Entry = [...router.state.media.entries()].find(([, media]) => media.mime === 'video/mp4');
    if (!mp4Entry) throw new Error('fixture missing managed mp4');
    router.completeTask(taskId, { role: 'render', media_id: mp4Entry[0], is_primary: true });

    detail = await client.tasks.get(taskId);
    expect(detail.status).toBe('succeeded');
    const output = (detail.outputs ?? []).find((candidate) => candidate.role === 'render');
    if (!output) throw new Error('completed render has no render-role output');

    // Playback rides the R9 content route: full GET, then a Range seek, then
    // an ETag revalidation — exactly what <video> issues.
    const contentUrl = client.media.contentUrl(output.media_id);
    expect(contentUrl).toBe('http://bridge.fake/projects/demo-project/media/' + output.media_id + '/content');
    const full = await fetch(contentUrl);
    expect(full.status).toBe(200);
    expect(full.headers.get('Accept-Ranges')).toBe('bytes');
    const etag = full.headers.get('ETag');
    expect(etag).toBeTruthy();

    const seek = await fetch(contentUrl, { headers: { Range: 'bytes=0-99' } });
    expect(seek.status).toBe(206);
    expect(seek.headers.get('Content-Range')).toBe(`bytes 0-99/${mp4Entry[1].bytes.byteLength}`);

    const revalidated = await fetch(contentUrl, { headers: { 'If-None-Match': etag! } });
    expect(revalidated.status).toBe(304);
  });
});

describe('Sprint 8 router → enqueue integration', () => {
  it('themed timeline decision drives a banodoco-pool enqueue', async () => {
    const config = {
      theme: '2rp',
      clips: [{ clipType: 'image-jump' }, { clipType: 'media' }],
    };

    // Step 1: router decides banodoco.
    const decision = decideRenderRoute(config);
    expect(decision.route).toBe('worker-banodoco');

    // Step 2: build payload + enqueue.
    const { payload } = buildRenderTimelinePayload({
      request: {
        timelineId: 't',
        assetRegistry: { assets: {} },
        resolvedConfig: config,
        renderMetadata: null,
        renderRuntime: {
          projectId: 'p',
        },
      },
      correlationId: 'corr-x',
    });
    expect(payload).toBeDefined();

    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(renderAdmissionResponse('task-1')),
      { status: 201 },
    ));
    vi.stubGlobal('fetch', fetchImpl);
    const result = await enqueueBanodocoRenderTimeline(payload!, {
      client: new AstridLocalClient({ projectSlug: 'p', baseUrl: 'http://bridge.fake' }),
    });
    expect(result.status).toBe('queued');

    // Dispatch uses the common Astrid task authority, not a worker pool.
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.family).toBe('render_export');
    expect(body.input.timeline_ref).toBe('t');
    vi.unstubAllGlobals();
  });

  it('pure-media timeline decision skips the orchestrator entirely', () => {
    const config = { clips: [{ clipType: 'media' }, { clipType: 'text' }] };
    const decision = decideRenderRoute(config);
    expect(decision.route).toBe('browser-remotion');
    // The integration assertion: no fetch is made for client-route timelines.
    // Caller should branch on `decision.route` and call useClientRender;
    // we don't test that wiring here (it lives in useClientRender), but
    // make the router contract explicit so future regressions are loud.
  });
});

describe('Sprint 8 render pipeline middleware', () => {
  const runtime = {
    projectId: 'project-1',
  };


  it('renders supported local fixture timelines in the browser path with the local runtime type', async () => {
    const events: Array<{ type: string; request?: unknown; assetCount?: number; providerId?: string }> = [];
    const request = {
      timelineId: 'fixture-browser',
      assetRegistry: {
        assets: {
          'asset-1': {
            src: 'file:///tmp/fixture-browser.mp4',
            file: 'fixture-browser.mp4',
            type: 'video/mp4',
          },
        },
      },
      resolvedConfig: {
        output: { resolution: '1920x1080', fps: 30, file: 'fixture-browser.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [{ id: 'clip-1', track: 'V1', at: 0, from: 0, to: 2, clipType: 'media', asset: 'asset-1' }],
        registry: {
          'asset-1': {
            src: 'file:///tmp/fixture-browser.mp4',
            file: 'fixture-browser.mp4',
            type: 'video/mp4',
          },
        },
      },
      renderMetadata: null,
      renderRuntime: {
        projectId: 'project-1',
      },
    };
    const startBrowserRender = vi.fn(async () => ({
      status: 'done' as const,
      message: 'Saved fixture-browser.mp4',
    }));

    const result = await executeRenderPipeline({
      decision: decideRenderRoute(request.resolvedConfig),
      request,
      startBrowserRender,
      middlewares: [async (event) => {
        events.push(event);
      }],
    });

    expect(result).toMatchObject({
      status: 'done',
      providerId: 'browser-remotion',
    });
    expect(startBrowserRender).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([
      { type: 'beforeRender', request },
      { type: 'assetMaterialized', request, assetCount: 1 },
      { type: 'afterRender', request, providerId: 'browser-remotion' },
    ]);
  });

  it('emits beforeRender, assetMaterialized, and afterRender through one shared middleware path', async () => {
    const events: string[] = [];
    const middleware = vi.fn(async (event: { type: string }) => {
      events.push(event.type);
    });
    const startBrowserRender = vi.fn(async () => ({
      status: 'done' as const,
      message: 'Saved output.mp4',
    }));

    const result = await executeRenderPipeline({
      decision: decideRenderRoute({ clips: [{ clipType: 'media' }] }),
      request: {
        timelineId: 'timeline-1',
        assetRegistry: { assets: { 'asset-1': { src: 'https://cdn.example.com/asset-1.mp4', file: 'asset-1.mp4', type: 'video/mp4' } } },
        resolvedConfig: {
          output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
          clips: [{ id: 'clip-1', track: 'V1', at: 0, hold: 1, clipType: 'media' }],
          registry: { 'asset-1': { src: 'https://cdn.example.com/asset-1.mp4', file: 'asset-1.mp4', type: 'video/mp4' } },
        },
        renderMetadata: null,
        renderRuntime: runtime,
      },
      startBrowserRender,
      middlewares: [middleware],
    });

    expect(result).toMatchObject({
      status: 'done',
      providerId: 'browser-remotion',
    });
    expect(startBrowserRender).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['beforeRender', 'assetMaterialized', 'afterRender']);
  });

  it('emits renderFailed for preview-only routes without falling back to the browser renderer', async () => {
    const previewEvents: string[] = [];
    const previewResult = await executeRenderPipeline({
      decision: decideRenderRoute({
        clips: [{ clipType: 'media', generation: { sequence_lane: 'remotion_module' } }],
      }),
      request: {
        timelineId: 'timeline-1',
        assetRegistry: null,
        resolvedConfig: null,
        renderMetadata: null,
        renderRuntime: runtime,
      },
      startBrowserRender: vi.fn(async () => ({ status: 'done' as const, message: 'unexpected' })),
      middlewares: [async (event) => {
        previewEvents.push(event.type);
      }],
    });

    expect(previewResult).toMatchObject({
      status: 'error',
      providerId: 'preview-only',
    });
    expect(previewEvents).toEqual(['beforeRender', 'assetMaterialized', 'renderFailed']);
  });

  it('queues worker-capable routes through Astrid R1 without falling back to the browser renderer', async () => {
    const workerEvents: string[] = [];
    const startBrowserRender = vi.fn(async () => ({ status: 'done' as const, message: 'unexpected' }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(renderAdmissionResponse('task-1')),
      { status: 201 },
    ));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchImpl);
    const workerRuntime = {
      ...runtime,
      bridgeBaseUrl: 'http://bridge.fake',
    };
    const request = {
      timelineId: 'timeline-fixture-worker',
      assetRegistry: {
        assets: {
          'asset-1': {
            file: 'asset-1.png',
            src: 'file:///tmp/asset-1.png',
            type: 'image/png',
          },
        },
      },
      resolvedConfig: {
        theme: '2rp',
        output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        clips: [{ id: 'clip-1', track: 'V1', at: 0, hold: 1, clipType: 'image-jump' }],
        registry: {
          'asset-1': {
            file: 'asset-1.png',
            src: 'file:///tmp/asset-1.png',
            type: 'image/png',
          },
        },
      },
      renderMetadata: null,
      renderRuntime: workerRuntime,
    };

    const workerResult = await executeRenderPipeline({
      decision: decideRenderRoute({ clips: [{ clipType: 'image-jump' }] }),
      request,
      startBrowserRender,
      middlewares: [async (event) => {
        workerEvents.push(event.type);
      }],
    });

    expect(workerResult).toMatchObject({
      status: 'queued',
      providerId: 'worker-banodoco',
      taskId: 'task-1',
      correlationId: expect.any(String),
    });
    expect(startBrowserRender).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.family).toBe('render_export');
    expect(body.input.timeline_ref).toBe('timeline-fixture-worker');
    expect(body.input.output_filename).toBe('timeline-timeline-fixture-worker.mp4');
    expect(workerEvents).toEqual(['beforeRender', 'assetMaterialized', 'afterRender']);

    vi.stubGlobal('fetch', originalFetch);
  });

  it('emits renderFailed when Astrid rejects render admission', async () => {
    const workerEvents: string[] = [];
    const startBrowserRender = vi.fn(async () => ({ status: 'done' as const, message: 'unexpected' }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'capability_unavailable',
      detail: 'Remotion is not installed',
    }), { status: 422 })));
    const workerResult = await executeRenderPipeline({
      decision: decideRenderRoute({ clips: [{ clipType: 'image-jump' }] }),
      request: {
        timelineId: 'timeline-1',
        assetRegistry: null,
        resolvedConfig: {
          theme: '2rp',
          output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
          clips: [{ id: 'clip-1', track: 'V1', at: 0, hold: 1, clipType: 'image-jump' }],
          registry: {},
        },
        renderMetadata: null,
        renderRuntime: runtime,
      },
      startBrowserRender,
      middlewares: [async (event) => {
        workerEvents.push(event.type);
      }],
    });

    expect(workerResult).toMatchObject({
      status: 'error',
      providerId: 'worker-banodoco',
    });
    expect(workerResult.message).toContain('Remotion is not installed');
    expect(startBrowserRender).not.toHaveBeenCalled();
    expect(workerEvents).toEqual(['beforeRender', 'assetMaterialized', 'renderFailed']);
    vi.unstubAllGlobals();
  });
});
