# Exact-source lint proofs

`absolute lint-proof` lets a trusted developer run an expensive lint command
locally and commit a small proof that CI can verify without running lint again.

```bash
absolute lint-proof run -- bun run lint:raw
git add -f .absolutejs/lint-proof.json
```

CI verifies the same command:

```bash
absolute lint-proof verify -- bun run lint:raw
```

Verification is fast and fails if any of these differ from the successful local
run:

- any tracked or non-ignored working-tree content;
- the lint command or its arguments;
- the ESLint configuration; or
- an installed ESLint, plugin, parser, or TypeScript package.

The proof file itself is excluded from the source digest, so updating its
timestamp does not invalidate it. The digest uses a temporary Git index and
temporary Git object database, so it does not modify the repository.

The default proof path is `.absolutejs/lint-proof.json`. Use `--proof <path>` on
both commands to choose another location.

## Signed attestations

For a CI gate that accepts proofs only from an authorized local signer, generate
an Ed25519 key pair and keep the private key outside the repository:

```bash
openssl genpkey -algorithm Ed25519 -out ~/.config/absolutejs/lint-proof.pem
openssl pkey -in ~/.config/absolutejs/lint-proof.pem -pubout \
  -out .absolutejs/lint-proof.pub.pem
```

Run lint with the private key:

```bash
absolute lint-proof run \
  --signing-key ~/.config/absolutejs/lint-proof.pem \
  -- bun run lint:raw
```

Require the corresponding public key in CI:

```bash
absolute lint-proof verify \
  --trusted-key .absolutejs/lint-proof.pub.pem \
  -- bun run lint:raw
```

When `--trusted-key` is present, verification fails closed if the proof is
unsigned, tampered, stale, or signed by another key. The signing key must be an
Ed25519 private key outside the Git working tree; AbsoluteJS refuses an in-tree
private key to reduce the risk of committing it.

## Trust boundary

An unsigned proof is a freshness and integrity proof, not remote execution
attestation. Signed mode additionally proves that the receipt was authorized by
the configured private key holder. It does not provide hardware-backed evidence
that a particular process ran.

Keep the private key limited to trusted developers, review changes to the
trusted public key and verification workflow, and protect both with repository
rules. A repository that accepts untrusted direct commits or lets contributors
replace its verification policy must not rely on lint proofs as its only gate.
