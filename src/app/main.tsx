import { renderApp } from '@/app/bootstrap';
import { initializeExtensionReleaseFlags } from '@/tools/video-editor/runtime/extensionReleaseControls';
import { installExtensionOperationalAnalyticsSink } from '@/tools/video-editor/runtime/extensionOperationalAnalytics';

async function main(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Failed to render app: element with id 'root' was not found.");
  }

  await initializeExtensionReleaseFlags({ development: import.meta.env.DEV });
  // The sink is isolated at the browser boundary; queue/retry failures are
  // swallowed and cannot delay or change editor runtime initialization.
  installExtensionOperationalAnalyticsSink();
  renderApp(rootElement);
}

void main();
