/**
 * Your in-progress extension goes here.
 *
 * `VideoEditorPage` concatenates this array into the editor's direct extensions
 * under `import.meta.env.DEV`, so the loop is: write the file → add one entry
 * here → refresh the browser. No page component to edit, no repository or bundle
 * store to stand up.
 *
 * Scaffold: copy `src/examples/hello-world-extension.ts`, rename the manifest id.
 * Sanity check: `?extensionSmoke=1` on the editor URL loads the host's own smoke
 * extension — if its status contribution appears, the host wiring is fine and
 * any problem is in your extension. Activation is logged under the
 * `[Extension lifecycle]` console group (`docs/video-editor/extensions-debugging.md` §2.1).
 *
 * The scene-phase-markers canary is registered here (DEV-only scratchpad). It
 * exercises the `timelineOverlay` family end-to-end: ruler markers rendered
 * through the host-owned `markerLayer`, playhead-store subscription, and
 * commit-time fresh-snapshot `project-data.write`.
 */
import type { ReighExtension } from '@reigh/editor-sdk';
import { scenePhaseMarkersExtension } from './scene-phase-markers/extension';

export const devLocalExtensions: ReighExtension[] = [
  scenePhaseMarkersExtension,
];
