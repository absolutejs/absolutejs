import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'The chunked lint (`absolute eslint --chunked`) started one ESLint process per 20 files, so every process re-read its cache and rebuilt the TypeScript program for type-aware rules: onSpark took 173 s across 146 processes with nothing to lint and 17 minutes cold. Files whose clean verdict ESLint has already cached (same content, toolchain, config and arguments) are now left out before any process starts, so an unchanged tree lints in about a second; a failing cached verdict is always linted again so it is reported, and a run that stops part-way never marks its cache as trustworthy. Chunk size now adapts to memory: each process reports its peak RSS and the next chunk grows or shrinks toward 60% of a per-process budget (the machine memory share over the concurrency, capped at the child heap), starting at 50 files. onSpark cold: 609 s in 20 processes. `--chunk-size <n>` still fixes the size.',
	kind: 'changed',
	summary:
		'The chunked lint skips files with a clean cached verdict and sizes chunks to memory',
	symbols: []
};
