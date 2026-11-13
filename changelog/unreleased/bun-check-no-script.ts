import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'When a project’s package.json has a `check` script, `bun check` runs that script instead of type-checking, so `absolute typecheck` could report a project as checked without checking it. It now always passes `--no-script`, which Bun added in 1.4.4, and so uses bun check from Bun 1.4.4 on (it was 1.4.3). On Bun 1.4.3 it type-checks with tsc, as on older Bun.',
	kind: 'fixed',
	summary:
		'absolute typecheck type-checks even when the project has a check script'
};
