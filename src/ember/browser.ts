/**
 * Phase 1 Ember client entry.
 *
 * The page index file (emitted by the build) imports this module and
 * the user's compiled page module. We mount the page component into
 * `#ember-root` using the same `renderComponent` API SSR used — Ember
 * Router's hydration story is post-Phase-1 work; for v1 we re-render
 * client-side over the SSR'd HTML.
 *
 * `@ember/renderer` is loaded dynamically rather than via static import
 * because (a) the AbsoluteJS framework typecheck shouldn't require
 * ember-source as a dep, and (b) the resolved URL at runtime is
 * `/ember/vendor/ember_renderer.js` (the vendor build's output) rather
 * than the bare specifier — only the user's bundle pass knows which
 * mapping to apply.
 */

declare global {
	interface Window {
		__INITIAL_PROPS__?: Record<string, unknown>;
	}
}

type RenderComponentApi = (
	component: unknown,
	options: {
		owner: Record<string, unknown>;
		into: Element;
		args: Record<string, unknown>;
	}
) => { destroy?: () => void };

export const mountEmberPage = async (
	component: unknown,
	rootSelector: string = '#ember-root'
) => {
	const root = document.querySelector(rootSelector);
	if (!root) {
		throw new Error(`mountEmberPage: no element matched "${rootSelector}"`);
	}

	// String-variable import indirection so TypeScript doesn't try to
	// resolve `@ember/renderer` at type-check time. The framework
	// package mustn't require ember-source as a build-time dep.
	const rendererSpecifier = '@ember/renderer';
	const rendererModule = (await import(rendererSpecifier)) as {
		renderComponent: RenderComponentApi;
	};
	const props = window.__INITIAL_PROPS__ ?? {};

	return rendererModule.renderComponent(component, {
		args: props,
		into: root,
		owner: {}
	});
};
