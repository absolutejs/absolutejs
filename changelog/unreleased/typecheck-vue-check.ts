import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'For a project with Vue, `absolute typecheck` now runs vue-check (`@absolutejs/vue-check`, a dependency of the framework) instead of vue-tsc whenever it runs bun check: the project’s own Vue codegen with Bun’s native checker, reporting the errors vue-tsc reports in a fraction of the time and memory. Its generated TypeScript stays in `.absolutejs/vue-check`. vue-tsc remains the fallback where tsc does: Bun older than 1.4.4, or `ABSOLUTE_TYPECHECK_CHECKER=tsc`.',
	kind: 'changed',
	summary: 'absolute typecheck checks Vue projects with vue-check'
};
