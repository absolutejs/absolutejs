import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`engines.bun` is now `>=1.4.2`. Bun 1.4.1 is skipped on purpose: it shipped a `bun build` regression that renamed a nested `var` to a `let` binding's name (`SyntaxError: Cannot declare a var variable that shadows a let/const/class variable`), which 1.4.2 fixes. One behavior change reaches compiled apps: a response whose body stream errors before its first byte is flushed now drops the connection instead of arriving as a complete, empty `200`, so clients see the failure instead of a truncated success.",
	kind: 'changed',
	summary: 'AbsoluteJS now requires Bun 1.4.2'
};
