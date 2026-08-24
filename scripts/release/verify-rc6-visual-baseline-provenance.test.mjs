import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
