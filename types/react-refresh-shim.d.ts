/* react-refresh ships no type declarations. The framework imports the runtime
 * by bare specifier (resolved at build time to the vendored copy in
 * src/dev/client/vendor/reactRefreshRuntime.js). This mirrors the members that
 * reactRefreshSetup and Bun's reactFastRefresh transform actually use. */

declare module 'react-refresh/runtime' {
	export const register: (type: unknown, id: string) => void;
	export const setSignature: (
		type: unknown,
		key: string,
		forceReset?: boolean,
		getCustomHooks?: () => unknown[]
	) => void;
	export const performReactRefresh: () => void;
	export const injectIntoGlobalHook: (win: Window) => void;
	export const createSignatureFunctionForTransform: () => (
		type: unknown
	) => unknown;
	export const isLikelyComponentType: (type: unknown) => boolean;
	export const hasUnrecoverableErrors: () => boolean;
}
