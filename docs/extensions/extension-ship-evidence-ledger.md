# Extension Ship Evidence Ledger

The canonical ship-quality checklist is intentionally separate from the older
extension-platform contract checklist. The former is a product release gate;
the latter proves narrower SDK and host contracts. A green contract checklist
must never be presented as a green ship-quality release.

The machine-readable release ledger is
[`config/releases/extension-ship-evidence.json`](../../config/releases/extension-ship-evidence.json).
Its 23 entries are derived, in order, from the numbered headings in
[`extension-ship-quality-checklist.md`](./extension-ship-quality-checklist.md).

Run the structural audit while integration is in progress:

```sh
npm run check:extension-ship-evidence
```

Run the fail-closed release gate only for a frozen candidate:

```sh
npm run check:extension-ship-evidence:release
```

The audit exits successfully when the ledger structure is sound and every
claimed `pass` has valid receipts. It still prints every open workstream. The
release gate requires 23/23 `pass`, frozen Reigh and Astrid commits, and evidence
receipts bound to those exact candidate commits.

## Candidate and evidence controller

The Reigh candidate commit (`C`) is the immutable product/source revision. The
annotated tag named by the release manifest and `REIGH_REF` must both resolve
exactly to `C`. The candidate ledger is still `integration` and leaves
`candidate.reighCommit` null because a tracked file cannot contain the hash of
the commit that contains it.

Release evidence is finalized in a clean controller commit (`H`) that is a
strict descendant of `C`. The verifier examines every parent edge in `C..H`, so
a forbidden edit is still rejected if a later commit reverts it. Every changed
path must be one of this code-owned allowlist:

- `config/releases/extension-ship-evidence.json`, for the frozen disposition,
  candidate pins, workstream statuses, blockers, and receipts;
- `config/releases/extension-ship-quality.json`, where the only permitted
  semantic change is exactly `status: integration` to `status: frozen`; or
- `docs/extensions/evidence/releases/<release>/`, the release-specific root for
  committed evidence artifacts.

No source, script, package/lock file, runbook, checklist, or other configuration
may change after `C`. Prefix lookalikes, deletions, renames that touch a path
outside the allowlist, outside-history merge parents, symlinks, gitlinks, and
executable evidence blobs fail closed. Allowed files must be committed ordinary
blobs. Freeze code, scripts, documentation, pins, and gate inventory before
creating the candidate tag; after it, commit only the evidence closure above.

## Receipt contract

Every passed workstream needs at least one receipt of the code-owned evidence
kind required by the gate. Each receipt records:

- a globally unique ID and evidence kind;
- `reigh` or `astrid` plus the exact 40-character commit;
- an exact UTC capture time;
- the command or human action and either exit code zero or an explicit signed
  approval;
- a non-secret environment identity and exact tool versions; and
- a repository-relative evidence artifact plus its SHA-256.

The gate resolves the artifact without following an escape outside the
repository and recomputes its hash from both the worktree and committed `H`
blob. Any edited, uncommitted, missing, external, symlinked, executable, or
non-zero receipt fails. In release mode, every receipt commit must equal the
frozen paired candidate (`C` for Reigh), never the evidence controller `H`.

Human acceptance cannot be replaced by agent or browser automation. Workstream
22 requires four separately identified receipts: working video editor,
accessibility user, transcript specialist, and first-time extension author.
Workstream 23 requires two distinct independent reviewer approvals.

Do not mark a row `pass` merely because a test or document exists. Capture the
actual output, hash it, disposition failures, and only then attach the receipt.
