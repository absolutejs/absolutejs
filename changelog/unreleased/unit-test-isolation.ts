import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`bun run test:unit` now runs through scripts/unitTests.ts: one `bun test` for the files that can share a process, and one process each for the files that cannot. A unit test that registers a DOM or mounts a framework leaves state behind for every file after it — a React hook test written against happy-dom took the document away from tests/unit/react/link.test.tsx and left its router update uncommitted, in either file order, which is why there were no React hook tests at all. The runner also fails if a file listed as isolated no longer exists, so the list cannot quietly stop isolating anything. tests/integration already worked this way through scripts/shardedTests.ts; that runner rsyncs the repository per shard, which suits a suite measured in minutes rather than this one's twenty seconds.",
	kind: 'internal',
	summary: 'The unit gate can give a test file its own process'
};
