import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'AbsoluteJS accepted `@absolutejs/auth` only below 0.77, so a project that added a current auth (0.77 to 0.96) got two copies: its own, plus 0.76.3 nested under AbsoluteJS for the mobile shell. The duplicate also doubled the auth type declarations TypeScript loads. AbsoluteJS now accepts auth up to 0.96. The `@absolutejs/auth/client/mobile` API it uses is byte-identical from 0.76.3 to 0.96.0, in both its declarations and its runtime.',
	kind: 'fixed',
	summary: 'Projects on a current `@absolutejs/auth` no longer get a second, older copy'
};
