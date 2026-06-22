import { describe, expect, it } from 'vitest';
import {
  ExtensionLoader,
  InMemoryExtensionStateRepository,
  validateExtensionPackage,
} from '@/tools/video-editor/extension';
import { videoEditorExtensionPackage } from './index';

describe('video editor extension example', () => {
  it('validates and loads through the public SDK contract', () => {
    expect(validateExtensionPackage(videoEditorExtensionPackage)).toEqual([]);

    const repository = new InMemoryExtensionStateRepository();
    repository.setState(
      videoEditorExtensionPackage.manifest.id,
      {
        enabled: true,
        settingsOverrides: {
          accent: 'green',
          showInspectorSummary: true,
        },
      },
    );

    const result = new ExtensionLoader(
      [videoEditorExtensionPackage],
      repository,
    ).load();

    expect(result.diagnostics).toEqual([]);
    expect(result.configs).toHaveLength(1);
    expect(result.installedPackages).toMatchObject([
      {
        manifest: { id: 'com.example.video-editor-extension' },
        loaded: true,
      },
    ]);
    expect(result.configs[0]?.settings).toEqual({
      accent: 'green',
      showInspectorSummary: true,
    });
    expect(result.commands.map((command) => command.id)).toEqual([
      'com.example.video-editor-extension.mark-review-ready',
    ]);
  });
});
