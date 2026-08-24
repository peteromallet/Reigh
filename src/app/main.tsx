import { renderApp } from '@/app/bootstrap';
import { initializeVideoEditorExtensionRuntime } from '@/tools/video-editor/browser';

async function main(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error("Failed to render app: element with id 'root' was not found.");
  }

  await initializeVideoEditorExtensionRuntime({ development: import.meta.env.DEV });
  renderApp(rootElement);
}

void main();
