import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'On Bun 1.4.3 or later, `absolute typecheck` checks TypeScript with `bun check` instead of tsc: it reads the same tsconfig.json and reports the same errors, about 15x faster with a third of the memory on this repository. bun check keeps no .tsbuildinfo, so a passing run is remembered as a fingerprint of every file and tsconfig it read, and an unchanged project is not checked again. Projects with Vue still use vue-tsc. Set ABSOLUTE_TYPECHECK_CHECKER=tsc to keep tsc, and ABSOLUTE_TYPECHECK_THREADS to cap the threads bun check starts. Stylesheet side-effect imports (`import "./app.css"`) are now declared, which TypeScript 7 requires.',
	kind: 'changed',
	summary:
		'absolute typecheck uses bun check on Bun 1.4.3+, with its own pass cache'
};
