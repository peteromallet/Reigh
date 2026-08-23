import { describe, expect, it } from 'vitest';
import type { TimelineOverlayRenderProps, TimelinePatch } from '@reigh/editor-sdk';
import {
  BRANCHING_CUT_EXTENSION_ID,
  BRANCHING_CUT_OVERLAY_RENDER_ID,
  BUILD_CHOICE_GATES_COMMAND,
  CHOICE_GATES_DATA_KEY,
  MAX_CLIP_LINKS_DISPLAY,
  SEQUENTIAL_LINK_SCHEMA_VERSION,
  branchingCutExtension,
  buildClipLinksPatch,
  deriveClipLinks,
  normalizeClipLinkTime,
  readChoiceGates,
  readClipLinkEnvelope,
  rebuildClipLinks,
} from './index';
import {
  createCreativeLabExtensionHarness,
  createCreativeLabSnapshot,
} from '../testing/createCreativeLabHarness';

const tracks = [
  { id: 'V1', kind: 'visual' as const, label: 'Primary', muted: false },
  { id: 'V2', kind: 'visual' as const, label: 'Muted auxiliary', muted: true },
  { id: 'A1', kind: 'audio' as const, label: 'Audio', muted: false },
];

describe('Sequential Clip-Link Scaffolder', () => {
  it('keeps the checked-in package manifest aligned with the public extension manifest', async () => {
    const manifestModule = await import('./reigh-extension.json');
    expect(manifestModule.default.manifest).toEqual(branchingCutExtension.manifest);
  });

  it('links adjacent valid clips at source clip ends on the primary visual track', () => {
    const clips = [
      { id: 'late', track: 'V1', at: 6, duration: 1, managed: false },
      { id: 'first', track: 'V1', at: 0, duration: 5, managed: false },
      { id: 'muted', track: 'V2', at: 20, duration: 1, managed: false },
      { id: 'audio', track: 'A1', at: 30, duration: 1, managed: false },
      { id: 'invalid', track: 'V1', at: Number.NaN, duration: 1, managed: false },
    ];
    const forward = deriveClipLinks({ clips, tracks });
    const reverse = deriveClipLinks({ clips: [...clips].reverse(), tracks: [...tracks].reverse() });
    expect(forward).toEqual(reverse);
    expect(forward).toEqual([expect.objectContaining({
      id: 'clip-link-first-to-late', sourceClipId: 'first', targetClipId: 'late',
      trackId: 'V1', time: 5, offset: 0,
    })]);
    expect(forward.some((link) => link.sourceClipId === 'muted' || link.targetClipId === 'audio')).toBe(false);
  });

  it('computes the complete graph, has no terminal self-link, and bounds only display', () => {
    const clips = Array.from({ length: MAX_CLIP_LINKS_DISPLAY + 10 }, (_, index) => ({
      id: `clip-${index}`, track: 'V1', at: index * 2, duration: 1, managed: false,
    }));
    const links = deriveClipLinks({ clips, tracks: [tracks[0]] });
    expect(links).toHaveLength(clips.length - 1);
    expect(links.at(-1)).toMatchObject({
      sourceClipId: `clip-${clips.length - 2}`,
      targetClipId: `clip-${clips.length - 1}`,
    });
    expect(links.every((link) => link.sourceClipId !== link.targetClipId)).toBe(true);
  });

  it('excludes malformed clips and does not clamp long clip-end boundaries', () => {
    const links = deriveClipLinks({
      tracks: [tracks[0]],
      clips: [
        { id: 'long', track: 'V1', at: 100_000, duration: 2, managed: false },
        { id: 'next', track: 'V1', at: 100_010, duration: 1, managed: false },
        { id: 'nan', track: 'V1', at: Number.NaN, duration: 1, managed: false },
        { id: 'negative', track: 'V1', at: 4, duration: -1, managed: false },
      ],
    });
    expect(links).toEqual([expect.objectContaining({ id: 'clip-link-long-to-next', time: 100_002 })]);
    expect(normalizeClipLinkTime(100_000)).toBe(100_000);
    expect(normalizeClipLinkTime(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('migrates legacy arrays into a versioned envelope without terminal semantics', () => {
    const legacyGate = {
      id: 'choice-gate-0-first', anchorClipId: 'first', trackId: 'V1', time: 5,
      label: 'Choice at first',
      branches: [
        { id: 'hold', label: 'Hold first', targetClipId: 'first' },
        { id: 'jump', label: 'Jump to next', targetClipId: 'next' },
      ],
    };
    const envelope = readClipLinkEnvelope({
      app: { [BRANCHING_CUT_EXTENSION_ID]: { [CHOICE_GATES_DATA_KEY]: [legacyGate] } },
    });
    expect(envelope).toMatchObject({ schemaVersion: SEQUENTIAL_LINK_SCHEMA_VERSION, generatedFromVersion: 0 });
    expect(envelope.entries).toEqual([expect.objectContaining({
      id: 'clip-link-first-to-next', sourceClipId: 'first', targetClipId: 'next', time: 5,
    })]);
  });

  it('preserves authored labels and offsets when surviving links rebuild', () => {
    const rebuilt = rebuildClipLinks(
      { tracks: [tracks[0]], clips: [
        { id: 'first', track: 'V1', at: 1, duration: 2, managed: false },
        { id: 'next', track: 'V1', at: 5, duration: 2, managed: false },
      ] },
      [{
        id: 'clip-link-first-to-next', sourceClipId: 'first', targetClipId: 'next', trackId: 'V1',
        time: 9, offset: 0.5, label: 'Authored link',
      }],
    );
    expect(rebuilt).toEqual([expect.objectContaining({ time: 3.5, offset: 0.5, label: 'Authored link' })]);
  });

  it('writes a transparent versioned owned patch', () => {
    const links = deriveClipLinks({ tracks: [tracks[0]], clips: [
      { id: 'a', track: 'V1', at: 1, duration: 2, managed: false },
      { id: 'b', track: 'V1', at: 5, duration: 2, managed: false },
    ] });
    const patch = buildClipLinksPatch(BRANCHING_CUT_EXTENSION_ID, createCreativeLabSnapshot({ baseVersion: 7 }), links);
    expect(patch.meta).toMatchObject({
      kind: 'sequential-clip-link-scaffolder-build',
      generatedFromVersion: 7,
      executableBranchEdits: false,
    });
    expect(patch.operations[0]).toMatchObject({
      op: 'project-data.write', target: BRANCHING_CUT_EXTENSION_ID,
      payload: { value: { schemaVersion: 1, generatedFromVersion: 7, entries: links } },
    });
  });

  it('registers, invokes, and guardedly disposes both handles', () => {
    const harness = createCreativeLabExtensionHarness(branchingCutExtension, createCreativeLabSnapshot({ tracks }));
    const activation = branchingCutExtension.activate?.(harness.ctx);
    expect(harness.getCommand(BUILD_CHOICE_GATES_COMMAND)).toEqual(expect.any(Function));
    expect(harness.getRenderer(BRANCHING_CUT_OVERLAY_RENDER_ID)).toEqual(expect.any(Function));
    harness.getCommand(BUILD_CHOICE_GATES_COMMAND)?.({ commandId: BUILD_CHOICE_GATES_COMMAND });
    expect(harness.patches).toHaveLength(1);
    activation?.dispose();
    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('bounds visible markers and commits an editable offset from a fresh snapshot', () => {
    const clips = [
      { id: 'a', track: 'V1', at: 24, duration: 12, managed: false },
      { id: 'b', track: 'V1', at: 40, duration: 4, managed: false },
    ];
    const stored = deriveClipLinks({ tracks: [tracks[0]], clips });
    const app = { [BRANCHING_CUT_EXTENSION_ID]: {
      [CHOICE_GATES_DATA_KEY]: { schemaVersion: 1, generatedFromVersion: 3, entries: stored },
    } };
    const harness = createCreativeLabExtensionHarness(branchingCutExtension, createCreativeLabSnapshot({ tracks: [tracks[0]], clips, app }));
    const activation = branchingCutExtension.activate?.(harness.ctx);
    const renderer = harness.getRenderer<TimelineOverlayRenderProps>(BRANCHING_CUT_OVERLAY_RENDER_ID);
    const rendered = renderer?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered.markers).toHaveLength(1);
    const custom = rendered.renderMarker(rendered.markers[0]);
    expect(custom.props['aria-label']).toContain('a');
    harness.setSnapshot(createCreativeLabSnapshot({ baseVersion: 11, currentVersion: 11, tracks: [tracks[0]], clips, app }));
    rendered.onChange({ id: stored[0].id, time: 37.5, phase: 'commit' });
    expect(harness.patches[0]).toMatchObject({
      version: 11,
      meta: { kind: 'sequential-clip-link-scaffolder-move', generatedFromVersion: 3 },
    });
    expect(harness.patches[0].operations[0].payload?.value).toMatchObject({
      entries: expect.arrayContaining([expect.objectContaining({ id: stored[0].id, time: 37.5, offset: 1.5 })]),
    });
    activation?.dispose();
  });

  it('ignores malformed and foreign persisted data', () => {
    expect(readChoiceGates({
      app: { [BRANCHING_CUT_EXTENSION_ID]: { [CHOICE_GATES_DATA_KEY]: { entries: [{ nope: true }] } } },
    })).toEqual([]);
    expect(readChoiceGates({ app: { other: { [CHOICE_GATES_DATA_KEY]: [] } } })).toEqual([]);
  });

  it('keeps the patch type explicit for public contract checks', () => {
    const patch: TimelinePatch = buildClipLinksPatch(
      BRANCHING_CUT_EXTENSION_ID,
      createCreativeLabSnapshot(),
      [],
    );
    expect(patch.operations[0].op).toBe('project-data.write');
  });
});
