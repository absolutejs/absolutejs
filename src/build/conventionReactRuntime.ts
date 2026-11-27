import type { BunPlugin } from 'bun';

/**
 * React convention pages (error, not-found, loading) are separate files the
 * renderer imports at run time, so they must call hooks on the React that
 * renders them. Bundled with their own copy, or resolving `react` on their
 * own, they reach a different React whenever the renderer's is elsewhere: in
 * a bundled server, in a compiled app, or simply in another node_modules.
 * Any hook then throws "Invalid hook call" and the page falls back to JSON
 * (absolutejs.ai's 404 page, 2026-11-27).
 *
 * So a convention page never resolves React itself. Its `react`,
 * `react/jsx-runtime` and `react/jsx-dev-runtime` imports compile to small
 * modules that read the runtime the renderer installs just before importing
 * it (`installConventionReactRuntime`), whichever copy that is.
 */

const RUNTIME_KEY = '__absoluteConventionReactRuntime';
const NAMESPACE = 'absolute-convention-react';
const RUNTIME_SPECIFIER = /^react(?:\/jsx-runtime|\/jsx-dev-runtime)?$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const runtimeExpression = `globalThis[${JSON.stringify(RUNTIME_KEY)}]`;
const missingRuntime = `throw new Error("A React convention page was loaded before the renderer installed its React runtime")`;

const reactModule = (names: string[]) => `const runtime = ${runtimeExpression};
if (!runtime) ${missingRuntime};
const React = runtime.react;
export default React;
export const { ${names.join(', ')} } = React;
`;

const jsxModule = (
	field: 'jsxDevRuntime' | 'jsxRuntime',
	names: string[]
) => `const runtime = ${runtimeExpression};
if (!runtime) ${missingRuntime};
export const { ${names.join(', ')} } = runtime.${field};
`;

const exportNames = (module: Record<string, unknown>) =>
	Object.keys(module).filter(
		(name) => name !== 'default' && IDENTIFIER.test(name)
	);

/** Build side: route a convention page's React imports to the renderer's. */
export const createConventionReactRuntimePlugin = async () => {
	const [react, jsxRuntime, jsxDevRuntime] = await Promise.all([
		import('react'),
		import('react/jsx-runtime'),
		import('react/jsx-dev-runtime')
	]);
	const sources: Record<string, string> = {
		react: reactModule(exportNames(react)),
		'react/jsx-dev-runtime': jsxModule(
			'jsxDevRuntime',
			exportNames(jsxDevRuntime)
		),
		'react/jsx-runtime': jsxModule('jsxRuntime', exportNames(jsxRuntime))
	};
	const plugin: BunPlugin = {
		name: 'convention-react-runtime',
		setup(build) {
			build.onResolve({ filter: RUNTIME_SPECIFIER }, ({ path }) => ({
				namespace: NAMESPACE,
				path
			}));
			build.onLoad(
				{ filter: /.*/, namespace: NAMESPACE },
				({ path }) => ({
					contents: sources[path] ?? '',
					loader: 'js'
				})
			);
		}
	};

	return plugin;
};

/** Run side: hand convention pages the React this renderer uses. Call it
 *  before importing a convention module; the first call wins. */
export const installConventionReactRuntime = async () => {
	if (Reflect.get(globalThis, RUNTIME_KEY)) return;
	const [react, jsxRuntime, jsxDevRuntime] = await Promise.all([
		import('react'),
		import('react/jsx-runtime'),
		import('react/jsx-dev-runtime')
	]);
	Reflect.set(globalThis, RUNTIME_KEY, {
		jsxDevRuntime,
		jsxRuntime,
		react: react.default ?? react
	});
};
