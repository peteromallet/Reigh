import { renderApp } from '@/app/bootstrap';
import { initializeExtensionReleaseFlags } from '@/tools/video-editor/runtime/extensionReleaseControls';

async function main(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Failed to render app: element with id 'root' was not found.");
  }

  await initializeExtensionReleaseFlags({ development: import.meta.env.DEV });
  renderApp(rootElement);
}

void main();
