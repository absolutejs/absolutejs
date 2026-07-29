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
does not modify the developer's real index.

The default proof path is `.absolutejs/lint-proof.json`. Use `--proof <path>` on
both commands to choose another location.

## Trust boundary

This is a freshness and integrity proof, not remote execution attestation. A
repository that accepts untrusted direct commits must not rely on it as its only
lint gate: someone who can change the source and workflow can also fabricate a
JSON proof. It is intended for repositories where direct committers are trusted
to run the recorded command and branch protection controls who can merge.
