import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Each ESLint process the chunked lint starts pays to build the TypeScript program again (onSpark: about 26 s of a 59 s, 209-file process), and the runner still started 20 of them for a cold onSpark lint, and one per touched cache shard for a small change. Verdicts now live in one cache: each process lints with its own scratch cache and its entries are merged in when it finishes, so any file can go to any process and a file only ever has its newest verdict. Chunks hold one kind of file (extension) and are sized from a line through that kind's (files, peak memory) observations, solved for 80% of the per-process budget (85% of the memory available when the run starts, over the processes running); the observations persist between runs. On onSpark a cold lint went from 609 s in 20 processes to 192 s in 11 (287 s with no history), a three-file change from 45 s in three processes to 15 s in one, and nothing to lint stays about a second. `--shards` is gone, and the earlier per-shard cache files are removed.",
	kind: 'changed',
	summary:
		'The chunked lint starts far fewer ESLint processes: cold onSpark lint 609 s to 192 s, a small change in one process',
	symbols: []
};
