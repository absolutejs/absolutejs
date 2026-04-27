declare module 'react-refresh/runtime' {
	export const createSignatureFunctionForTransform: () => (
		type: unknown
	) => unknown;
	export const injectIntoGlobalHook: (win: Window) => void;
	export const performReactRefresh: () => void;
	export const register: (type: unknown, id: string) => void;
}
