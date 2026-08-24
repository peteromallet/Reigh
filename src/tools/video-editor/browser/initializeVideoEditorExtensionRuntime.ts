import {
  initializeExtensionReleaseFlags,
} from '../runtime/extensionReleaseControls.ts';
import {
  installExtensionOperationalAnalyticsSink,
} from '../runtime/extensionOperationalAnalytics.ts';

export interface InitializeVideoEditorExtensionRuntimeOptions {
  readonly development: boolean;
}

/**
 * Initialize the browser-owned extension runtime before the host renders.
 *
 * Release controls must settle before React reads them. Operational analytics
 * remains best-effort and is installed only after that release snapshot is
 * available. Keeping this composition behind the browser contract prevents
 * app shells from depending on video-editor runtime internals.
 */
export async function initializeVideoEditorExtensionRuntime(
  options: InitializeVideoEditorExtensionRuntimeOptions,
): Promise<void> {
  await initializeExtensionReleaseFlags(options);
  installExtensionOperationalAnalyticsSink();
}
