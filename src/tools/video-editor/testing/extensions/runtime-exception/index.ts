/**
 * Runtime exception fixture extension.
 *
 * This extension intentionally throws during render and from its visibility
 * predicate so that tests can verify:
 *  - The editor does not blank when an extension slot/panel/dialog throws
 *  - The diagnostics store receives `extension_render_exception` and
 *    `extension_visibility_exception` diagnostics
 *  - Fallback UI renders in place of the broken extension content
 */

import type { VideoEditorExtensionConfig } from '@/tools/video-editor/runtime/extensionSurface.ts';

export const RUNTIME_EXCEPTION_EXTENSION_ID = 'fixture.runtime-exception';

/**
 * Throwing slot renderer — always throws when invoked.
 */
function throwingSlotRenderer(): never {
  throw new Error('Fixture: slot renderer intentional exception');
}

/**
 * Throwing visibility predicate — always throws when invoked.
 */
function throwingVisibilityPredicate(): never {
  throw new Error('Fixture: visibility predicate intentional exception');
}

/**
 * Throwing dialog/panel/inspector renderer.
 */
function throwingDescriptorRenderer(): never {
  throw new Error('Fixture: descriptor renderer intentional exception');
}

const runtimeExceptionExtension: VideoEditorExtensionConfig = {
  extensionId: RUNTIME_EXCEPTION_EXTENSION_ID,
  slots: {
    statusBar: throwingSlotRenderer,
  },
  dialogHost: {
    dialogs: [
      {
        id: 'fixture.runtime-exception.dialog',
        render: throwingDescriptorRenderer,
      },
    ],
  },
  registry: {
    panels: [
      {
        id: 'fixture.runtime-exception.panel',
        placement: 'asset-panel',
        render: throwingDescriptorRenderer,
      },
    ],
    inspectorSections: [
      {
        id: 'fixture.runtime-exception.inspector-section',
        placement: 'after-default',
        when: throwingVisibilityPredicate,
        render: throwingDescriptorRenderer,
      },
    ],
  },
};

export default runtimeExceptionExtension;
