import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  lstatSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  statSync,
  utimesSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_MANIFEST_PATH,
  REPO_ROOT,
  createGitBlobSnapshot,
  readGitBlob,
  resolveGitCacheNamespace,
  verifyVisualBaselineProvenance,
} from './verify-rc6-visual-baseline-provenance.mjs';

// An outer release supervisor may terminate this worker between a fixture's
// create() and finally blocks. Keep cleanup scoped to paths registered by this
// process so an interrupted run cannot leave probe files in tracked evidence.
const registeredTemporaryPaths = new Set();
function cleanupRegisteredTemporaryPaths() {
  for (const path of registeredTemporaryPaths) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* best effort during signal */ }
  }
}
process.once('SIGTERM', () => {
  cleanupRegisteredTemporaryPaths();
  process.exit(143);
});
process.once('SIGINT', () => {
  cleanupRegisteredTemporaryPaths();
  process.exit(130);
});

function withManifest(mutator, callback) {
  const root = mkdtempSync(resolve(tmpdir(), 'rc6-visual-provenance-test-'));
  registeredTemporaryPaths.add(root);
  const path = resolve(root, 'manifest.json');
  const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
  mutator(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  try {
    return callback(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
    registeredTemporaryPaths.delete(root);
  }
}

const VISUAL_DIFF_ROOT = resolve(
  REPO_ROOT,
  'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs',
);

// A SIGTERM sent to `node --test` can reach the runner before its worker,
// leaving a fixture created by that worker without running its finally block.
// On the next run, reclaim only this test's PID-prefixed probe names whose
// owning PID is definitely gone. Live or reused PIDs are never touched.
function isLiveProcess(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function removeTemporaryEntry(path) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    return;
  }
  if (stats.isDirectory()) {
    try {
      // Never recurse: a nonempty directory is left intact for inspection.
      rmdirSync(path);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST') return;
      if (error?.code !== 'ENOTDIR') return;
      try { unlinkSync(path); } catch { /* raced with another cleanup */ }
    }
    return;
  }
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== 'EISDIR' && error?.code !== 'EPERM') return;
    try { rmdirSync(path); } catch { /* raced or nonempty; never recurse */ }
  }
}

function cleanupStaleTemporaryArtifacts() {
  for (const name of readdirSync(VISUAL_DIFF_ROOT)) {
    const match = name.match(/^(\d+)-\d+-(?:symlink|directory|untracked-same-bytes)\.diff\.png$/);
    if (!match || isLiveProcess(Number(match[1]))) continue;
    removeTemporaryEntry(resolve(VISUAL_DIFF_ROOT, name));
  }
}

cleanupStaleTemporaryArtifacts();
let temporaryArtifactOrdinal = 0;

function withTemporaryArtifact(name, create, callback) {
  temporaryArtifactOrdinal += 1;
  const uniqueName = `${process.pid}-${temporaryArtifactOrdinal}-${name}`;
  const artifactPath = resolve(VISUAL_DIFF_ROOT, uniqueName);
  registeredTemporaryPaths.add(artifactPath);
  try {
    create(artifactPath);
    return callback(artifactPath, uniqueName);
  } finally {
    rmSync(artifactPath, { recursive: true, force: true });
    registeredTemporaryPaths.delete(artifactPath);
  }
}

it('does not recursively delete an unrelated nonempty stale probe directory', () => {
  const path = resolve(VISUAL_DIFF_ROOT, `${Number.MAX_SAFE_INTEGER}-1-directory.diff.png`);
  const child = resolve(path, 'keep-me.txt');
  mkdirSync(path);
  writeFileSync(child, 'must survive');
  try {
    cleanupStaleTemporaryArtifacts();
    assert.equal(readFileSync(child, 'utf8'), 'must survive');
    assert.equal(lstatSync(path).isDirectory(), true);
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

function createTemporaryGitRepo(root, contents) {
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'rc6-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'RC6 test']);
  writeFileSync(resolve(root, 'blob.txt'), contents);
  execFileSync('git', ['-C', root, 'add', '--', 'blob.txt']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'fixture']);
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

it('rebuilds run-scoped Git snapshots across repository replacement, object loss, and test swaps', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'rc6-git-cache-test-'));
  try {
    const firstCommit = createTemporaryGitRepo(root, 'first');
    const firstNamespace = resolveGitCacheNamespace(root);
    assert.equal(readGitBlob(root, firstNamespace, firstCommit, 'blob.txt').toString(), 'first');

    // Replace .git in-place. Canonical path alone must not reuse the first
    // repository's bytes; inode identity and object-store metadata change.
    rmSync(resolve(root, '.git'), { recursive: true, force: true });
    const secondCommit = createTemporaryGitRepo(root, 'second');
    const secondNamespace = resolveGitCacheNamespace(root);
    assert.notEqual(secondNamespace, firstNamespace);
    assert.equal(readGitBlob(root, secondNamespace, secondCommit, 'blob.txt').toString(), 'second');

    // Removing the object store changes the namespace, and the fresh probe
    // fails rather than reusing bytes cached under the old store identity.
    const objectsDir = resolve(root, execFileSync('git', ['-C', root, 'rev-parse', '--git-path', 'objects'], { encoding: 'utf8' }).trim());
    const missingObjectsDir = `${objectsDir}.missing`;
    renameSync(objectsDir, missingObjectsDir);
    mkdirSync(objectsDir);
    try {
      const missingNamespace = resolveGitCacheNamespace(root);
      assert.notEqual(missingNamespace, secondNamespace);
      assert.throws(
        () => readGitBlob(root, missingNamespace, secondCommit, 'blob.txt'),
        /could not read .* from Git/,
      );
    } finally {
      rmSync(objectsDir, { recursive: true, force: true });
      renameSync(missingObjectsDir, objectsDir);
    }

    // A failed read is never cached. After the same path becomes available
    // under a new commit/store fingerprint, it is read normally.
    assert.throws(
      () => readGitBlob(root, secondNamespace, secondCommit, 'missing.txt'),
      /could not read .* from Git/,
    );
    writeFileSync(resolve(root, 'missing.txt'), 'recovered');
    execFileSync('git', ['-C', root, 'add', '--', 'missing.txt']);
    execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'recovery']);
    const recoveredCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const recoveredNamespace = resolveGitCacheNamespace(root);
    assert.notEqual(recoveredNamespace, secondNamespace);
    assert.equal(readGitBlob(root, recoveredNamespace, recoveredCommit, 'missing.txt').toString(), 'recovered');

    // A different temporary repository cannot inherit either cache namespace.
    const otherRoot = mkdtempSync(resolve(tmpdir(), 'rc6-git-cache-swap-'));
    try {
      createTemporaryGitRepo(otherRoot, 'other');
      assert.notEqual(resolveGitCacheNamespace(otherRoot), secondNamespace);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('rejects an in-place loose Git object replacement even with restored metadata', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'rc6-git-object-integrity-'));
  try {
    const commit = createTemporaryGitRepo(root, 'integrity');
    const namespace = resolveGitCacheNamespace(root);
    assert.equal(readGitBlob(root, namespace, commit, 'blob.txt').toString(), 'integrity');

    const blob = execFileSync('git', ['-C', root, 'rev-parse', `${commit}:blob.txt`], { encoding: 'utf8' }).trim();
    const objectPath = resolve(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
    const original = readFileSync(objectPath);
    const originalStats = statSync(objectPath);
    try {
      // Keep the path, inode, size, and timestamps as close as possible to the
      // original while corrupting the object. A namespace/metadata cache must
      // not turn the prior successful bytes into a false PASS.
      chmodSync(objectPath, 0o600);
      writeFileSync(objectPath, Buffer.alloc(original.length, 0));
      utimesSync(objectPath, originalStats.atime, originalStats.mtime);
      assert.throws(() => readGitBlob(root, namespace, commit, 'blob.txt'), /could not (?:probe|read) .* Git/);
    } finally {
      writeFileSync(objectPath, original);
      chmodSync(objectPath, originalStats.mode & 0o7777);
      utimesSync(objectPath, originalStats.atime, originalStats.mtime);
    }
    assert.equal(readGitBlob(root, namespace, commit, 'blob.txt').toString(), 'integrity');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('revalidates a run-scoped Git snapshot after in-run object tampering', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'rc6-git-snapshot-integrity-'));
  try {
    const commit = createTemporaryGitRepo(root, 'snapshot');
    const namespace = resolveGitCacheNamespace(root);
    const snapshot = createGitBlobSnapshot(root, namespace, [{ commit, path: 'blob.txt' }]);
    assert.equal(snapshot.read(commit, 'blob.txt').toString(), 'snapshot');

    const blob = execFileSync('git', ['-C', root, 'rev-parse', `${commit}:blob.txt`], { encoding: 'utf8' }).trim();
    const objectPath = resolve(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
    const original = readFileSync(objectPath);
    const originalStats = statSync(objectPath);
    try {
      chmodSync(objectPath, 0o600);
      writeFileSync(objectPath, Buffer.alloc(original.length, 0));
      utimesSync(objectPath, originalStats.atime, originalStats.mtime);
      assert.throws(() => snapshot.revalidate(), /could not read .* from Git/);
    } finally {
      writeFileSync(objectPath, original);
      chmodSync(objectPath, originalStats.mode & 0o7777);
      utimesSync(objectPath, originalStats.atime, originalStats.mtime);
    }
    snapshot.revalidate();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
      (_artifactPath, uniqueName) => withManifest((manifest) => {
        manifest.entries[0].reviewedDiffArtifact.path =
          `docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs/${uniqueName}`;
      }, (manifestPath) => {
        assert.throws(
          () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
          /must not contain symlinks/,
        );
      }),
    );
  });

  it('rejects a non-regular reviewed diff artifact', () => {
    withTemporaryArtifact(
      'directory.diff.png',
      (artifactPath) => mkdirSync(artifactPath),
      (_artifactPath, uniqueName) => withManifest((manifest) => {
        manifest.entries[0].reviewedDiffArtifact.path =
          `docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs/${uniqueName}`;
      }, (manifestPath) => {
        assert.throws(
          () => verifyVisualBaselineProvenance({ repoRoot: REPO_ROOT, manifestPath }),
          /must be a regular file/,
        );
      }),
    );
  });

  it('rejects an untracked file even when its bytes match the committed artifact', () => {
    withTemporaryArtifact(
      'untracked-same-bytes.diff.png',
      (artifactPath) => writeFileSync(
        artifactPath,
        readFileSync(resolve(VISUAL_DIFF_ROOT, 'composed-desktop.diff.png')),
      ),
      (_artifactPath, uniqueName) => withManifest((manifest) => {
        manifest.entries[0].reviewedDiffArtifact.path =
          `docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs/${uniqueName}`;
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
    withManifest(() => {}, (manifestPath) => {
      assert.throws(
        () => verifyVisualBaselineProvenance({
          repoRoot: REPO_ROOT,
          manifestPath,
          readWorktreeArtifact: (path) => path === artifactPath
            ? Buffer.concat([originalBytes, Buffer.from([0])])
            : readFileSync(path),
        }),
        /reviewed diff artifact worktree bytes do not match/,
      );
    });
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
