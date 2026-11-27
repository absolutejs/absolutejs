import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'A command proof covers every file, so it also covered the lint proof sitting next to it: re-signing lint (after any lint-only change) invalidated the test proof and meant running the whole suite again. `absolute proof run` and `verify` now take `--exclude <path>` (repeatable). The excluded paths are part of the signed payload and verify must name exactly the same ones, so a proof cannot be stretched afterwards to ignore anything else; only files inside the repository can be excluded, never a directory. A proof with no exclusions signs exactly as before, so existing proofs still verify.',
	kind: 'added',
	summary:
		'`absolute proof --exclude <path>`: a test proof can leave the lint proof out of its tree',
	symbols: []
};
