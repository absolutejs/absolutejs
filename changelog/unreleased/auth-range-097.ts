import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'AbsoluteJS accepted `@absolutejs/auth` only below 0.97, so a project on auth 0.97 got a second, older copy nested under AbsoluteJS. It now accepts auth up to 0.97. Between 0.96.0 and 0.97.0 the `@absolutejs/auth/client/mobile` declarations are byte-identical, and its runtime differs only in bundler helpers and local variable names.',
	kind: 'fixed',
	summary:
		'Projects on `@absolutejs/auth` 0.97 no longer get a second, older copy'
};
