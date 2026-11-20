import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A module that must stay on the server can now say so with `import '@absolutejs/absolute/server-only'`, and every browser bundling pass fails the build if it resolves that import, naming the file that holds it. There was previously no way to declare the boundary at all, so a server module pulled into a page's client bundle by one stray barrel-file re-export was found by a browser rather than by the build. The same passes now also report `process.env.X` read in the project's own client code. Bun does not inline it into a browser bundle, so nothing leaked — the reference survived verbatim and the browser threw `ReferenceError: process is not defined` when the module evaluated, which a `NEXT_PUBLIC_`-style prefix convention would not have prevented either. `process.env.NODE_ENV` stays allowed because Bun substitutes it in every browser bundle, as does any key the pass defines and any read tested with `typeof process`; dependencies are skipped. References are found by parsing, so the text `process.env` in a string, a comment or a template literal is not one. `clientBoundary: { processEnv: 'error' | 'warn' | 'off' }` sets the behaviour; it defaults to failing `absolute build` and warning under `absolute dev`, where failing a bundling pass would take down every page in it rather than the one module at fault.",
	kind: 'added',
	summary:
		'A server-only marker, and process.env in client code is a build error',
	symbols: ['BaseBuildConfig']
};
