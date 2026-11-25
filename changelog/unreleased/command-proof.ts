import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: '`absolute proof run --signing-key <key> -- <command>` runs any command (a test suite, most often) and, when it passes, writes a signed proof of that pass; `absolute proof verify --trusted-key <key> -- <command>` lets CI accept the proof in seconds instead of running the command again. A proof is bound to the whole working tree (every file Git would track, the proof itself excepted), the exact command and the exact Bun (`Bun.version`, build label included). `run` refuses to sign when the command changed files while it ran. The signature is Ed25519, the signing key must live outside the repository, and the payload is domain-separated from `lint-proof`\'s so neither signature can pass for the other. `lint-proof` now shares the same key and tree code; its behaviour and messages are unchanged.',
	kind: 'added',
	summary: 'Signed proofs for any command, so CI can skip re-running a test suite',
	symbols: []
};
