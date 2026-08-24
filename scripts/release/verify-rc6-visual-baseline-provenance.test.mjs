import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_MANIFEST_PATH,
  REPO_ROOT,
  verifyVisualBaselineProvenance,
} from './verify-rc6-visual-baseline-provenance.mjs';

function withManifest(mutator, callback) {
  const root = mkdtempSync(resolve(tmpdir(), 'rc6-visual-provenance-test-'));
  const path = resolve(root, 'manifest.json');
  const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
  mutator(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    return callback(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const VISUAL_DIFF_ROOT = resolve(
  REPO_ROOT,
  'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs',
);

function withTemporaryArtifact(name, create, callback) {
  const artifactPath = resolve(VISUAL_DIFF_ROOT, name);
  try {
    create(artifactPath);
    return callback(artifactPath);
  } finally {
    rmSync(artifactPath, { force: true });
  }
}

describe('RC6 visual baseline provenance verifier', () => {
  it('recomputes all old/new hashes, dimensions, and exact pixel ratios', () => {
    const result = verifyVisualBaselineProvenance({
      repoRoot: REPO_ROOT,
      manifestPath: DEFAULT_MANIFEST_PATH,
    });
    assert.equal(result.release, 'extension-ship-quality-rc6');
    assert.equal(result.entries.length, 6);
    assert.equal(result.entries[0].diff.changedPixels, 27874);
    assert.equal(result.entries[0].reviewedDiffArtifact.sha256, 'eed012aef1a4b0492bdbca0b40b7648f31ba35f647b354712bcd10ac7380a0ee');
    assert.equal(result.entries[1].reviewedDiffArtifact.sha256, 'c82a1b4dbe453f1f74e8f94ddae69eb54088f0bac5402d7150d2c66b870884c5');
    assert.equal(result.entries[2].reviewedDiffArtifact.sha256, 'c26da78f0fb12ad16f09b500633043902b7ddfe102c8f46baa2f43671247d3ee');
    assert.equal(result.entries[3].diff.pixelDiffRatio, 0);
    assert.equal(result.review.human.status, 'pending-release-owner-review');
  });

  it('fails when a recorded ratio no longer matches the old/new image bytes', () => {
    withManifest((manifest) => {
      manifest.entries[0].diff.pixelDiffRatio = 0;
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /diff mismatch.*pixelDiffRatio/,
      );
    });
  });

  it('fails when a baseline hash is changed or the source binding drifts', () => {
    withManifest((manifest) => {
      manifest.entries[1].new.sha256 = '0'.repeat(64);
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /current image hash does not match provenance/,
      );
    });
  });

  it('fails when a reviewed diff artifact is changed', () => {
    withManifest((manifest) => {
      manifest.entries[0].reviewedDiffArtifact.sha256 = '0'.repeat(64);
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /reviewed diff artifact hash does not match/,
      );
    });
  });

  it('fails when a baseline is omitted from the exact RC6 path set', () => {
    withManifest((manifest) => {
      manifest.entries.pop();
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /exactly 6 entries/,
      );
    });
  });

  it('fails when a same-size but substituted diff artifact is retained', () => {
    withManifest((manifest) => {
      const artifact = manifest.entries[0].reviewedDiffArtifact;
      // The composed baseline has the same dimensions as its diff artifact,
      // but its pixels are not the canonical red/white diff mask.
      artifact.path = 'tests/e2e/visual-snapshots/composed-desktop.png';
      artifact.sha256 = manifest.entries[0].new.sha256;
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /canonical repository-relative path under docs\/extensions\/evidence\/releases\/extension-ship-quality-rc6\/visual-diffs/,
      );
    });
  });

  it('rejects an absolute path to an otherwise canonical diff artifact', () => {
    withManifest((manifest) => {
      manifest.entries[0].reviewedDiffArtifact.path = resolve(
        REPO_ROOT,
        manifest.entries[0].reviewedDiffArtifact.path,
      );
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /canonical repository-relative path under docs\/extensions\/evidence\/releases\/extension-ship-quality-rc6\/visual-diffs/,
      );
    });
  });

  it('rejects traversal paths even when they normalize inside the repository', () => {
    withManifest((manifest) => {
      manifest.entries[0].reviewedDiffArtifact.path =
        'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs/../visual-diffs/composed-desktop.diff.png';
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /must not contain empty, current-directory, or traversal segments/,
      );
    });
  });

  it('rejects a symlinked reviewed diff artifact', () => {
    withTemporaryArtifact(
      'symlink.diff.png',
      (artifactPath) => symlinkSync(
        resolve(VISUAL_DIFF_ROOT, 'composed-desktop.diff.png'),
        artifactPath,
      ),
      () => withManifest((manifest) => {
        manifest.entries[0].reviewedDiffArtifact.path =
          'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs/symlink.diff.png';
      }, (manifestPath) => {
        assert.throws(
          () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
          /must not contain symlinks/,
        );
      }),
    );
  });

  it('rejects a non-regular reviewed diff artifact', () => {
    const artifactPath = resolve(VISUAL_DIFF_ROOT, 'directory.diff.png');
    mkdirSync(artifactPath);
    try {
      withManifest((manifest) => {
        manifest.entries[0].reviewedDiffArtifact.path =
          'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs/directory.diff.png';
      }, (manifestPath) => {
        assert.throws(
          () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
          /must be a regular file/,
        );
      });
    } finally {
      rmSync(artifactPath, { recursive: true, force: true });
    }
  });

  it('rejects an untracked file even when its bytes match the committed artifact', () => {
    withTemporaryArtifact(
      'untracked-same-bytes.diff.png',
      (artifactPath) => writeFileSync(
        artifactPath,
        readFileSync(resolve(VISUAL_DIFF_ROOT, 'composed-desktop.diff.png')),
      ),
      () => withManifest((manifest) => {
        manifest.entries[0].reviewedDiffArtifact.path =
          'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs/untracked-same-bytes.diff.png';
      }, (manifestPath) => {
        assert.throws(
          () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
          /could not read .* from Git/,
        );
      }),
    );
  });

  it('rejects worktree bytes that diverge from the bound artifact commit', () => {
    const artifactPath = resolve(VISUAL_DIFF_ROOT, 'composed-desktop.diff.png');
    const originalBytes = readFileSync(artifactPath);
    try {
      writeFileSync(artifactPath, Buffer.concat([originalBytes, Buffer.from([0])]));
      withManifest(() => {}, (manifestPath) => {
        assert.throws(
          () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
          /reviewed diff artifact worktree bytes do not match/,
        );
      });
    } finally {
      writeFileSync(artifactPath, originalBytes);
    }
  });

  it('rejects duplicate reviewed diff artifact paths', () => {
    withManifest((manifest) => {
      manifest.entries[1].reviewedDiffArtifact.path = manifest.entries[0].reviewedDiffArtifact.path;
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /duplicate reviewed diff artifact path/,
      );
    });
  });

  it('fails when baseline paths are duplicated', () => {
    withManifest((manifest) => {
      manifest.entries[1].path = manifest.entries[0].path;
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /duplicate visual baseline path/,
      );
    });
  });

  it('fails when an extra unexpected baseline path replaces an expected one', () => {
    withManifest((manifest) => {
      manifest.entries[5].path = 'tests/e2e/visual-snapshots/unexpected.png';
    }, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
        /unexpected: tests\/e2e\/visual-snapshots\/unexpected\.png/,
      );
    });
  });
});
