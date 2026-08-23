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
| Review selected proposal | The selected transcript item's inspector shows current source beside proposed text/timing and exposes individually labelled accept/reject controls. | Resolves only that stable `sourceItemId`; other pending proposals are unchanged. |
| Accept proposals | Accepts only records whose current transcript fingerprint still equals the fingerprint captured when proposed. | Writes `accepted-for-source-update` records for an upstream owner to consume. It does not impersonate that owner. |
| Reject proposals | Durably marks every pending record `rejected`. | No source write. |
| Source-owner acknowledgement | Binds the owner, returned source revision, applied-source fingerprint, and the exact accepted handoff fingerprint into `acknowledged-by-source-owner`. | Records proof supplied by the upstream owner; the dev adapter still performs no source write. |

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
- The handoff fingerprint covers the stable source id, inspected source
  fingerprint, proposed text/timing, edited-output fingerprint, schema, and
  generator version. An acknowledgement for another handoff is rejected.
- Exact acknowledgement replay is an idempotent no-op. A different owner,
  revision, applied-source fingerprint, or handoff after acknowledgement is a
  conflict rather than a silent replacement.
- `accepted-for-source-update` is always labelled **awaiting upstream
  acknowledgement**. Only `acknowledged-by-source-owner` may be presented as an
  applied acknowledgement, and it includes the owner and returned source
  revision.

The existing batch actions remain available, and the selected-item inspector
now provides per-record comparison and decisions. The host passes the canonical
`sourceItemId`, source artifact reference, and adapter provenance into that
inspector so decisions do not accidentally bind to a derived occurrence id.
Final release evidence still requires a real upstream transcript owner to
consume an accepted handoff, apply it, and submit the acknowledgement contract
in a production-like project; the local dev adapter deliberately cannot produce
that evidence itself.
