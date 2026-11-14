import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Importing `@absolutejs/absolute` (and its `build`, `angular`, `angular/server` and `mobile` entry points) loaded the `typescript` package straight away, which takes a few hundred milliseconds of CPU, even though a running server never needs it. TypeScript now loads the first time the framework actually uses it (route scanning, island registries, Angular compilation, config editing), so servers start faster. Nothing you call changed, and those functions stay synchronous.',
	kind: 'changed',
	summary:
		'Servers start faster: the framework no longer loads TypeScript at import'
};
