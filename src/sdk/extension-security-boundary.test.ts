import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXTENSION_PACKAGE_LIMITS,
  validateInstalledPackage,
  validateManifest,
  type ExtensionManifest,
  type InstalledExtensionPackage,
} from '@/sdk/manifest';
import { creativeLabExtensions } from '@/tools/video-editor/examples/extensions/creative-lab';
import { scenePhaseMarkersExtension } from '@/tools/video-editor/dev/scene-phase-markers/extension';
import { transcriptLaneExtension } from '@/tools/video-editor/dev/transcript-lane/extension';
import { runawayTimelineExtension } from '@/tools/video-editor/dev/runaway-timeline/extension';

const bundledExtensions = [
  scenePhaseMarkersExtension,
  transcriptLaneExtension,
  runawayTimelineExtension,
  ...creativeLabExtensions,
];

function checkedManifestFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...checkedManifestFiles(absolute));
    else if (entry.name === 'reigh-extension.json') files.push(absolute);
  }
  return files.sort();
}

function manifest(overrides: Record<string, unknown> = {}): ExtensionManifest {
  return {
    id: 'com.example.secure' as never,
    version: '1.0.0',
    label: 'Secure extension',
    publisher: 'Example',
    license: 'MIT',
    ...overrides,
  } as ExtensionManifest;
}

function installedPack(overrides: Partial<InstalledExtensionPackage> = {}): InstalledExtensionPackage {
  const baseManifest = manifest();
  return {
    metadata: {
      extensionId: baseManifest.id,
      version: baseManifest.version,
      integrity: { algorithm: 'sha256', value: 'test-integrity' },
      enabled: true,
    },
    manifest: baseManifest,
    bundleContent: 'export const activate = () => undefined;',
    ...overrides,
  };
}

describe('extension security boundary', () => {
  it('keeps the 13 reviewed bundled extensions valid and least-privileged', () => {
    expect(bundledExtensions).toHaveLength(13);
    expect(new Set(bundledExtensions.map((extension) => extension.manifest.id)).size).toBe(13);

    for (const extension of bundledExtensions) {
      const result = validateManifest(extension.manifest);
      expect(result.errors, String(extension.manifest.id)).toEqual([]);
      expect(extension.manifest.permissions ?? []).toEqual([]);
      expect(extension.manifest.processes ?? []).toEqual([]);
      for (const contribution of extension.manifest.contributions ?? []) {
        if (['command', 'keybinding', 'contextMenuItem'].includes(contribution.kind)) {
          expect((contribution as { command: string }).command).toMatch(
            new RegExp(`^${String(extension.manifest.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`),
          );
        }
      }
    }
  });

  it('runtime-validates all 18 checked JSON manifests under the security policy', () => {
    const directory = path.resolve(import.meta.dirname, '../tools/video-editor/examples/extensions');
    const files = checkedManifestFiles(directory);
    expect(files).toHaveLength(18);

    for (const file of files) {
      const envelope = JSON.parse(fs.readFileSync(file, 'utf8')) as { manifest: ExtensionManifest };
      const result = validateManifest(envelope.manifest);
      expect(result.errors, path.relative(directory, file)).toEqual([]);
    }
  });

  it('blocks commands outside the declaring extension namespace', () => {
    const result = validateManifest(manifest({
      contributions: [{
        id: 'steal' as never,
        kind: 'command',
        command: 'com.example.victim.deleteEverything',
        label: 'Steal command',
      }],
    }));

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'manifest/command-namespace-violation',
      contributionId: 'steal',
    }));
  });

  it('blocks keybindings and context menus that target undeclared commands', () => {
    for (const contribution of [
      {
        id: 'shortcut' as never,
        kind: 'keybinding',
        command: 'com.example.secure.notDeclared',
        key: 'Alt+Q',
      },
      {
        id: 'menu' as never,
        kind: 'contextMenuItem',
        command: 'com.example.secure.notDeclared',
        target: 'clip',
      },
    ]) {
      const result = validateManifest(manifest({ contributions: [contribution] }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        code: 'manifest/undeclared-command-target',
      }));
    }
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://insecure.example/icon.png',
    '//attacker.example/icon.png',
    '../secret/icon.png',
    'icons/%2e%2e/secret.png',
    'icons/%2fsecret.png',
    'icons/%5csecret.png',
    'icons/%2E%2E%5Csecret.png',
    'https://user:password@example.com/icon.png',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
  ])('rejects unsafe manifest icon URL %s', (icon) => {
    const result = validateManifest(manifest({ icon }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'manifest/unsafe-icon-url',
    }));
  });

  it.each([
    'https://cdn.example/icon.png',
    '/assets/extensions/icon.webp',
    './icons/icon.gif',
    'icons/icon.png',
    'data:image/png;base64,iVBORw0KGgo=',
  ])('accepts safe bounded icon URL %s', (icon) => {
    expect(validateManifest(manifest({ icon })).valid).toBe(true);
  });

  it('rejects oversized manifests and installed bundles before loading', () => {
    const oversizedManifest = validateManifest(manifest({
      description: 'x'.repeat(EXTENSION_PACKAGE_LIMITS.MAX_MANIFEST_BYTES),
    }));
    expect(oversizedManifest.errors).toContainEqual(expect.objectContaining({
      code: 'manifest/size-exceeded',
    }));

    const oversizedBundle = validateInstalledPackage(installedPack({
      bundleContent: 'x'.repeat(EXTENSION_PACKAGE_LIMITS.MAX_BUNDLE_BYTES + 1),
    }));
    expect(oversizedBundle.errors).toContainEqual(expect.objectContaining({
      code: 'package/bundle-size-exceeded',
    }));
  });

  it('rejects unsafe installed metadata icons even when the manifest icon is safe', () => {
    const pack = installedPack();
    const result = validateInstalledPackage({
      ...pack,
      metadata: { ...pack.metadata, icon: 'javascript:alert(1)' },
    });
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'package/unsafe-icon-url',
    }));
  });

  it('fails closed on malformed or excessive contribution collections', () => {
    expect(() => validateManifest(manifest({ contributions: [null] }))).not.toThrow();
    expect(validateManifest(manifest({ contributions: [null] })).errors).toContainEqual(
      expect.objectContaining({ code: 'manifest/invalid-contribution' }),
    );

    const contributions = Array.from(
      { length: EXTENSION_PACKAGE_LIMITS.MAX_CONTRIBUTIONS + 1 },
      (_, index) => ({ id: `item-${index}` as never, kind: 'panel' }),
    );
    expect(validateManifest(manifest({ contributions })).errors).toContainEqual(
      expect.objectContaining({ code: 'manifest/contribution-count-exceeded' }),
    );
  });
});
