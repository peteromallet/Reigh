# RC6 visual baseline refresh provenance

`visual-baseline-provenance.json` is the machine-verifiable record for the
refresh committed by `0d4c36ae470759ac1e9489c523fd450bcb786a58`. It binds every
retained Playwright screenshot to the previous baseline at
`b87720385079f2b097bd02a2ec2e7e9cf40c688f`, recording both image SHA-256 hashes,
dimensions, exact changed-pixel ratios, absolute channel-difference ratios,
browser/version, viewport, visual configuration, source-file hashes, and agent
and human review metadata. The three composed screenshots changed; the three
Runaway state screenshots are byte-identical and therefore have zero diff.

The verifier reads the old PNG bytes directly from the old Git commit and the
new PNG bytes from the checked-in worktree and refresh commit. It decodes the
PNG pixels itself, so a changed image, source binding, dimension, or recorded
metric fails closed. It also checks the visual spec/config hashes. No baseline
PNG is regenerated or updated by the provenance verifier.

Run the focused check with:

```sh
node scripts/release/verify-rc6-visual-baseline-provenance.mjs
node --test scripts/release/verify-rc6-visual-baseline-provenance.test.mjs
```

The human review status is intentionally explicit: the agent metric review is
recorded, while release-owner visual review remains pending until a person has
inspected the refresh and updates the metadata with their identity and time.
