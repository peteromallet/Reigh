# Transcript Caption Round-Trip Policy

Transcript Caption Foundry treats adapted transcript data as read-only source.
It never silently rewrites a transcript provider from an editable video-text
clip. The video timeline and transcript source have different owners and may be
saved, migrated, or refreshed independently.

## User actions

| Action | Output behavior | Transcript behavior |
| --- | --- | --- |
| Add missing | Creates deterministic built-in text clips for source intervals that do not currently have one. Existing generated clips, including human edits, are preserved. | No source write. |
| Regenerate | Rebuilds deterministic clips from the current transcript, replaces edits, and removes stale generated split/merge derivatives. | No source write. |
| Propose edits | Compares host-authored generated/output fingerprints and creates one durable `pending-review` record for each changed one-to-one caption. | No source write. |
| Accept proposals | Accepts only records whose current transcript fingerprint still equals the fingerprint captured when proposed. | Writes `accepted-for-source-update` records for an upstream owner to consume. It does not impersonate that owner. |
| Reject proposals | Durably marks every pending record `rejected`. | No source write. |

Acceptance is fail-closed. If a source interval changed or disappeared after a
proposal was created, the record becomes `source-conflict` with a typed reason;
the edit is not accepted. Accepted/rejected/conflicted records are terminal and
re-running either decision is an idempotent no-op.

## Edge policy

- Empty or whitespace-only source text does not create a caption.
- Unicode text is preserved as JSON text; no ASCII normalization is applied.
- Overlapping speakers remain overlapping timed captions. The extension does
  not invent speaker arbitration.
- Text and retiming changes on a deterministic one-to-one generated clip can be
  proposed.
- Deleting a generated caption is an output-local choice. **Add missing** or
  **Regenerate** can recreate it; deletion is not interpreted as transcript
  deletion because the deleted output no longer carries reviewable provenance.
- Manual split/merge derivatives remain output-local. **Regenerate** removes
  stale generated derivatives and rebuilds from current source. A transcript
  owner must perform source-level split/merge before the adapter can expose new
  source identities.
- Accepted records are a handoff contract, not proof that a provider applied
  the change. A provider integration must acknowledge consumption separately
  before the transcript itself is presented as updated.

The current editor action resolves pending records in a batch. A per-record
review surface with source/output comparison remains required for final human
acceptance; the ship-evidence ledger must not mark transcript round-trip `pass`
until that UI and an upstream consumption acknowledgement are verified in a
real project.
