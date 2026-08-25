# Extension human attestation gate

Human acceptance and independent review receipts are release authority, not
ordinary prose. A `reviewerId` string does not prove who approved a release.
The release evidence gate therefore requires OpenSSH Ed25519 signatures from
explicitly trusted principals before any `human` or `review` receipt is valid.

## Trust configuration

Populate
[`config/releases/extension-ship-attestation-trust.json`](../../config/releases/extension-ship-attestation-trust.json)
before freezing the release. Each `publicKey` is the two-field, comment-free
contents of an Ed25519 `.pub` file:

```json
{
  "schemaVersion": 1,
  "release": "<manifest.release>",
  "namespace": "reigh-extension-ship-evidence-v1",
  "identities": [
    {
      "principal": "alice-video-editor",
      "publicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...",
      "fingerprint": "SHA256:<verified-base64-fingerprint>",
      "kind": "human",
      "persona": "video-editor"
    },
    {
      "principal": "riley-release-reviewer",
      "publicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...",
      "fingerprint": "SHA256:<verified-base64-fingerprint>",
      "kind": "review"
    }
  ]
}
```

Release mode fails closed until the configuration has six distinct principals
and six distinct keys:

- one for each of `video-editor`, `accessibility-user`,
  `transcript-specialist`, and `first-time-extension-author`;
- at least two independently keyed `review` principals.

Do not commit private keys. Collect public keys through an authenticated channel
and confirm their fingerprints with each participant out of band. Key rotation
requires replacing the trust entry and re-signing affected receipts; old
signatures cannot silently authorize a new key.

Register a received public key through the no-private-key operator CLI. It
normalizes the OpenSSH public key, computes its Ed25519 fingerprint, prevents a
duplicate principal/key/persona assignment, and atomically updates trust:

```sh
npm run extension:evidence -- fingerprint --public-key /path/to/alice.pub
npm run extension:evidence -- register-key \
  --principal alice-video-editor --kind human --persona video-editor \
  --public-key /path/to/alice.pub
npm run extension:evidence -- verify-keys
```

Confirm the printed fingerprint with the participant over an authenticated
out-of-band channel before committing it. `register-key` accepts only public
key files; signing remains a separate participant action.

## Receipt and signing flow

First capture the typed human-session or independent-review document with the
operator flow in
[`extension-ship-evidence-ledger.md`](extension-ship-evidence-ledger.md#external-evidence-operator-flow),
then generate or append its unsigned receipt. A human receipt includes its
assigned `persona`; a review receipt carries the reviewer identity mirrored
from the document. Both use `"decision": "approve"`. All other receipt fields
and the referenced evidence artifact must be final before signing.

The signer then runs this from the repository root with their private key:

```sh
node scripts/quality/sign-extension-ship-receipt.mjs \
  --workstream 22-human-acceptance-testing \
  --receipt human-video-editor-acceptance \
  --principal alice-video-editor \
  --key /absolute/path/to/private-key
```

The helper refuses to overwrite an existing attestation, verifies that the
principal is authorized for that receipt and persona, signs with the fixed
`reigh-extension-ship-evidence-v1` SSH namespace, verifies the signature against
the checked-in public key, and then atomically updates the ledger. Review the
ledger diff and commit it with its evidence artifact.

The signed canonical envelope contains:

- a versioned payload schema and SSH namespace;
- the release identifier and both frozen candidate commits;
- the exact workstream ID and title;
- every receipt field except the detached `attestation` object.

Consequently, changing a decision, persona, artifact hash, environment, commit,
workstream, release, or candidate invalidates the signature. Copying a valid
receipt into another release also fails. `reviewerId` is deprecated metadata: if
present, it must exactly mirror the trusted attestation principal and is never
used to establish reviewer independence.

## Verification

During integration, run:

```sh
npm run check:extension-ship-evidence
```

Missing trust assignments are reported as open warnings while no manual receipt
claims approval. Release verification is strict:

```sh
npm run check:extension-ship-evidence:release
```

It requires all six trust assignments, validates every manual signature using a
single-principal temporary `allowed_signers` file, and counts the two reviewer
approvals by distinct trusted public keys—not by receipt-supplied IDs.
