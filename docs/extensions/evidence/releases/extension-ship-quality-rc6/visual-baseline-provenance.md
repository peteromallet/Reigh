# RC6 visual baseline refresh provenance

`visual-baseline-provenance.json` is the machine-verifiable record for the
final refresh committed by `e906a208c5fbbd4378165b8b1c59c5fbf33fc4cc`. It
preserves the initial composed refresh at
`0d4c36ae470759ac1e9489c523fd450bcb786a58` and its final full-Runaway-timing
correction. It binds every retained Playwright screenshot to the previous baseline at
`b87720385079f2b097bd02a2ec2e7e9cf40c688f`, recording both image SHA-256 hashes,
dimensions, exact changed-pixel ratios, absolute channel-difference ratios,
browser/version, viewport, visual configuration, source-file hashes, and agent
and human review metadata. The three composed screenshots changed; each has a
retained, hashed red-highlight diff PNG under `visual-diffs`. Each retained
diff record also pins its artifact to the full Git commit that contains that
PNG (`bedcc493c8f3d4ddc3a932487bbca2c8acf029d9`). This artifact commit is
deliberately separate from the baseline source commit: the visual diff can be
committed after the baseline refresh without creating a circular `HEAD`
binding. The three Runaway state screenshots are byte-identical and therefore
have zero diff.

The verifier reads the old PNG bytes directly from the old Git commit and the
new PNG bytes from the checked-in worktree and refresh commit. Reviewed diff
artifacts must be canonical repository-relative regular files strictly below
`visual-diffs/`, with no traversal, symlink, duplicate, or untracked path. The
worktree bytes must equal the blob at each artifact's pinned Git commit. It
decodes the PNG pixels itself and recomputes the exact red-highlight mask, so a
changed image, source binding, dimension, artifact provenance, or recorded
metric fails closed. It also checks the visual spec/config hashes. No baseline
PNG is regenerated or updated by the provenance verifier.

Run the focused check with:

```sh
node scripts/release/verify-rc6-visual-baseline-provenance.mjs
node --test scripts/release/verify-rc6-visual-baseline-provenance.test.mjs
```

The independent Luna visual review inspected desktop, tablet, and phone plus
all three diff artifacts and recorded a PASS disposition. The human review
status is intentionally explicit: release-owner visual review remains pending
until a person has inspected the refresh and updates the metadata with their
identity and time.
