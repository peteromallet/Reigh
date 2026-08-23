/**
 * Reviewed bundled extensions plus the local authoring entrypoint.
 *
 * `VideoEditorPage` filters this array through deployment-owned parent/child
 * release flags. Production defaults closed; DEV defaults open and also honors
 * the Extension Manager's local disabled-ID store. The authoring loop remains:
 * write the file → add one entry here → refresh the browser.
 *
 * Scaffold: copy `src/examples/hello-world-extension.ts`, rename the manifest id.
 * Sanity check: `?extensionSmoke=1` on the editor URL loads the host's own smoke
 * extension — if its status contribution appears, the host wiring is fine and
 * any problem is in your extension. Activation is logged under the
 * `[Extension lifecycle]` console group (`docs/video-editor/extensions-debugging.md` §2.1).
 *
 * The scene-phase-markers canary is registered here. It
 * exercises the `timelineOverlay` family end-to-end: ruler markers rendered
 * through the host-owned `markerLayer`, playhead-store subscription, and
 * commit-time fresh-snapshot `project-data.write`.
 *
 * The transcript-lane example is also registered here. It
 * exercises the `dataKind` family end-to-end: declare a dataKind
 * contribution, bind renderers via `ctx.dataKinds.register()` at activation,
 * and see host-adapted transcript segments painted as a duration-neutral
 * lane under the timeline tracks.
 */
import type { ReighExtension } from '@reigh/editor-sdk';
import { scenePhaseMarkersExtension } from './scene-phase-markers/extension';
import { transcriptLaneExtension } from './transcript-lane/extension';
import { creativeLabExtensions } from '../examples/extensions/creative-lab';
import { runawayTimelineExtension } from './runaway-timeline/extension';

export const devLocalExtensions: ReighExtension[] = [
  scenePhaseMarkersExtension,
  transcriptLaneExtension,
  runawayTimelineExtension,
  ...creativeLabExtensions,
];
