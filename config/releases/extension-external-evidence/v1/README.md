# Extension external-evidence format v1

The six JSON templates in `templates/` are intentionally invalid drafts: an
operator must replace every empty or `null` value with observed evidence. The
strict, closed-object validators live in
`scripts/quality/lib/extension-external-evidence.mjs`; unknown fields fail so a
misspelled or newly invented claim cannot silently enter a release receipt.

The envelope binds every document to one release, the exact Reigh/Astrid
candidate pair, a UTC capture time, and exact tool versions. Content validators
then enforce the transcript acknowledgement, two-read rollout record,
production probe/dashboard/rate-limit/alerts, three recovery drills, four human
personas, and independent review slots A/B. These templates contain no real
evidence and do not authorize a ledger `pass`.
