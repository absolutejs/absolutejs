import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The Angular router hand-off shipped in 0.20.0-beta.247 wired the handler into a page's injected `provideRouter(...)` by importing `@absolutejs/absolute/angular/components` from the page's compiled server output. That output is loaded unbundled, from the generated directory, so the specifier had to resolve at runtime — and it does not when a page is compiled somewhere that cannot reach the package or its built output, which is how the framework's own colocated-routes SSR test compiles a page into a temp directory. The injected call now reads the handler from a well-known global (`ROUTER_HANDOFF_KEY`, also exported) that the page's hydration index publishes, and the index is bundled at build time where the specifier resolves once. Behaviour is unchanged in an app; on the server the global is unset, which is right — a hand-off is a browser concept, and a failed server-side navigation is reported exactly as Angular always has.",
	kind: 'internal',
	summary:
		'The Angular router hand-off no longer resolves a package specifier at runtime',
	symbols: ['ROUTER_HANDOFF_KEY']
};
