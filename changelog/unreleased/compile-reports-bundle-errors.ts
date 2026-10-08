import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'When the last step of `absolute compile` ("Compiling standalone executable") failed, it printed only `AggregateError: Bundle failed`, because Bun throws by default. It now reports failures as data, like the server bundle step, so each error is printed with its file and message.',
	kind: 'fixed',
	summary:
		'absolute compile prints the real error when the executable fails to bundle'
};
