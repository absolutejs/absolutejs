import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute typecheck` failed with TS6059 on every source file of a project whose tsconfig sets `outDir`. TypeScript 7 requires every file to sit under rootDir even when nothing is emitted, and with rootDir unset it defaults to the directory of the generated config, `.absolutejs`, whenever outDir is set; the AbsoluteJS docs site reported 20 such errors and its CI had to use plain tsc. bun check never emits, so its generated config now roots the check at the filesystem root, which contains every file it reads, including a script kept beside the project. Real type errors are reported as before; tsc's incremental check keeps the project root.",
	kind: 'fixed',
	summary:
		'`absolute typecheck` works for projects whose tsconfig sets outDir'
};
