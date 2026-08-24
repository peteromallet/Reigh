import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  attestNativeTools,
  sha256File,
} from './native-tool-attestation.mjs';

function makeFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'native-tool-attestation-'));
  const bin = resolve(root, 'bin');
  const data = resolve(root, 'tessdata');
  mkdirSync(bin);
  mkdirSync(data);
  const eng = resolve(data, 'eng.traineddata');
  writeFileSync(eng, 'fixture-traineddata-v1');

  const scripts = {
    ffmpeg: '#!/bin/sh\nprintf \'ffmpeg version 7.1.1\\nbuilt fixture compiler\\nconfiguration: fixture\\n\'',
    ffprobe: '#!/bin/sh\nprintf \'ffprobe version 7.1.1\\nbuilt fixture compiler\\nconfiguration: fixture\\n\'',
    tesseract: `#!/bin/sh\nif [ "$1" = "--list-langs" ]; then printf 'List of available languages in "${data}"\\neng\\n'; else printf 'tesseract 5.5.1\\n leptonica-fixture\\n  fixture libraries\\n'; fi`,
    magick: '#!/bin/sh\nprintf \'Version: ImageMagick 7.1.2-18 fixture\\nCopyright: fixture\\nLicense: fixture\\n\'',
  };
  for (const [name, source] of Object.entries(scripts)) {
    const path = resolve(bin, name);
    writeFileSync(path, source);
    chmodSync(path, 0o755);
  }

  const identity = {
    ffmpeg: 'ffmpeg version 7.1.1\nbuilt fixture compiler\nconfiguration: fixture',
    ffprobe: 'ffprobe version 7.1.1\nbuilt fixture compiler\nconfiguration: fixture',
    tesseract: 'tesseract 5.5.1\n leptonica-fixture\n  fixture libraries',
    imageMagick: 'Version: ImageMagick 7.1.2-18 fixture\nCopyright: fixture\nLicense: fixture',
  };
  const manifest = {
    verification: {
      ffmpeg: { executable: 'ffmpeg', version: '7.1.1', executableSha256: `sha256:${sha256File(resolve(bin, 'ffmpeg'))}`, buildIdentity: identity.ffmpeg },
      ffprobe: { executable: 'ffprobe', version: '7.1.1', executableSha256: `sha256:${sha256File(resolve(bin, 'ffprobe'))}`, buildIdentity: identity.ffprobe },
      tesseract: { executable: 'tesseract', version: '5.5.1', executableSha256: `sha256:${sha256File(resolve(bin, 'tesseract'))}`, engDataSha256: `sha256:${sha256File(eng)}`, buildIdentity: identity.tesseract },
      imageMagick: { executable: 'magick', version: '7.1.2-18', executableSha256: `sha256:${sha256File(resolve(bin, 'magick'))}`, buildIdentity: identity.imageMagick },
    },
  };
  return {
    root,
    bin,
    eng,
    manifest,
    pathValue: `${bin}${delimiter}/usr/bin`,
    run(command, args) {
      return spawnSync(command, args, { encoding: 'utf8' });
    },
  };
}

describe('native tool attestation', () => {
  it('attests every executable, exact build identity, and Tesseract eng data', () => {
    const fixture = makeFixture();
    try {
      const result = attestNativeTools(fixture);
      for (const name of ['ffmpeg', 'ffprobe', 'tesseract', 'imageMagick']) {
        assert.equal(result.tools[name].executableSha256, fixture.manifest.verification[name].executableSha256);
        assert.equal(result.tools[name].buildIdentity, fixture.manifest.verification[name].buildIdentity);
      }
      assert.equal(result.tools.tesseract.engDataSha256, fixture.manifest.verification.tesseract.engDataSha256);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('fails closed for missing tools, PATH substitution, and identity/hash drift', () => {
    const fixture = makeFixture();
    try {
      assert.throws(
        () => attestNativeTools({ ...fixture, pathValue: '/empty' }),
        /pinned native executable is missing from PATH/,
      );

      const substituted = makeFixture();
      try {
        writeFileSync(resolve(substituted.bin, 'ffmpeg'), '#!/bin/sh\nprintf \'ffmpeg version 7.1.1\\nsubstituted\\nconfiguration: fixture\\n\'');
        chmodSync(resolve(substituted.bin, 'ffmpeg'), 0o755);
        assert.throws(
          () => attestNativeTools(substituted),
          /ffmpeg executable hash mismatch/,
        );
      } finally {
        rmSync(substituted.root, { recursive: true, force: true });
      }

      const identityDrift = structuredClone(fixture.manifest);
      identityDrift.verification.ffprobe.buildIdentity = 'ffprobe version 7.1.1\ndrift\nconfiguration: fixture';
      assert.throws(
        () => attestNativeTools({ ...fixture, manifest: identityDrift }),
        /ffprobe build identity mismatch/,
      );

      const dataDrift = structuredClone(fixture.manifest);
      dataDrift.verification.tesseract.engDataSha256 = `sha256:${'0'.repeat(64)}`;
      assert.throws(
        () => attestNativeTools({ ...fixture, manifest: dataDrift }),
        /language data hash mismatch/,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
