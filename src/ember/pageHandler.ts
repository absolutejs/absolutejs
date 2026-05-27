import { pathToFileURL } from 'node:url';
import { ssrErrorPage } from '../utils/ssrErrorPage';

/**
 * Phase 1 Ember page handler.
 *
 * The compiled `pagePath` is a self-contained server bundle produced by
 * `compileEmber`. It exports `renderToHTML(props): string` — a one-call
 * entry that wires up simple-dom + the Glimmer renderer + the page
 * component, then returns serialized HTML. The handler's job is just:
 *
 *  1. Auto-inject `request.url` pathname into props as `url` (mirrors
 *     React/Svelte/Vue handlers — the convention all four adapters now
 *     share for native router cooperation).
 *  2. Polyfill `globalThis.Element` / `globalThis.Node` if missing. The
 *     Ember server bundle also installs the polyfill defensively, but
 *     installing here too means the polyfill is in place before the
 *     bundle's module body evaluates (any top-level Element refs).
 *  3. Dynamic-import the bundle, call `renderToHTML(props)`, wrap the
 *     result in a `<head>` + `<body>` shell with `__INITIAL_PROPS__`
 *     and the page index module load.
 *
 *  Phase 1 doesn't ship: streaming, slots, islands, HMR cache dirty,
 *  convention error rendering. Those layer on in phases 2 and 3.
 */

export type EmberPageRequestInput = {
	indexPath: string;
	pagePath: string;
	headTag?: `<head>${string}</head>`;
	props?: Record<string, unknown>;
	/** When provided, the request's pathname is auto-injected into props
	 *  as `url` (only if the caller didn't already pass one). Lets users
	 *  forward `request` straight from the Elysia handler instead of
	 *  unwrapping the URL by hand. */
	request?: Request;
};

const resolveRequestPathname = (request: Request | undefined) => {
	if (!request) return undefined;

	try {
		const parsed = new URL(request.url);

		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return undefined;
	}
};

// EMBER_BANDAID #3 — see `docs/EMBER_BANDAID.md`. Drop once `@ember/renderer`
// stops reading `globalThis.Element` to decide whether to clear the
// target's innerHTML. Upstream fix needed in emberjs/ember.js.
const installSimpleDomGlobals = () => {
	const g = globalThis as { Element?: unknown; Node?: unknown };
	if (typeof g.Element === 'undefined') {
		g.Element = class Element {};
	}
	if (typeof g.Node === 'undefined') {
		g.Node = class Node {};
	}
};

type EmberServerBundle = {
	renderToHTML: (props?: Record<string, unknown>) => string;
};

// Bust Bun's ESM module cache between rebuilds so HMR-recompiled
// bundles get re-evaluated instead of returning the previously
// imported module instance. Mirrors the Angular and Vue handlers'
// cache-busting strategy. The suffix is bumped by `markEmberSsrDirty`
// from rebuildTrigger; the page handler reads it on each request.
let emberCacheBuster = 0;

const buildRuntimeModuleSpecifier = (modulePath: string) => {
	if (emberCacheBuster === 0) return modulePath;
	const moduleUrl = new URL(pathToFileURL(modulePath).href);
	moduleUrl.searchParams.set('t', String(emberCacheBuster));

	return moduleUrl.href;
};

/* Bumps `emberCacheBuster` so the next dynamic-import of the page
   bundle bypasses Bun's ESM module cache and re-evaluates the
   freshly-compiled bytes. Called from the dev rebuild trigger after
   an ember edit; consumed by `buildRuntimeModuleSpecifier`. The call
   crosses the bundle boundary cleanly because both writer and reader
   live in the ember pageHandler module — same dist bundle, same
   `emberCacheBuster` instance. */
export const invalidateEmberSsrCache = () => {
	emberCacheBuster = Date.now();
};

const buildHtmlShell = (
	headTag: string,
	bodyContent: string,
	indexPath: string,
	props: Record<string, unknown> | undefined
) => {
	const propsScript = `window.__INITIAL_PROPS__=${JSON.stringify(props ?? {})};`;
	const indexImport = indexPath
		? `<script type="module" src="${indexPath}"></script>`
		: '';

	return (
		`<!DOCTYPE html><html>${headTag}<body>` +
		`<div id="ember-root">${bodyContent}</div>` +
		`<script>${propsScript}</script>${indexImport}</body></html>`
	);
};

export const handleEmberPageRequest = async (input: EmberPageRequestInput) => {
	const { indexPath, pagePath, headTag } = input;
	const userProps = input.props;
	const requestPathname = resolveRequestPathname(input.request);
	// Auto-inject `url` from the request when the caller didn't already
	// pass one in props. Same convention as the React/Svelte/Vue adapters.
	const props =
		requestPathname !== undefined && (!userProps || !('url' in userProps))
			? { ...(userProps ?? {}), url: requestPathname }
			: userProps;

	const resolvedHeadTag = headTag ?? '<head></head>';

	try {
		installSimpleDomGlobals();
		const bundle = (await import(
			buildRuntimeModuleSpecifier(pagePath)
		)) as EmberServerBundle;
		if (typeof bundle.renderToHTML !== 'function') {
			throw new Error(
				`Ember page bundle at ${pagePath} does not export renderToHTML(). ` +
					`Was it compiled by compileEmber()?`
			);
		}

		const innerHtml = bundle.renderToHTML(props ?? {});

		const html = buildHtmlShell(
			resolvedHeadTag,
			// simple-dom's serializer wraps the root <div>. Strip the outer
			// div so we don't double-wrap inside #ember-root.
			innerHtml.replace(/^<div>|<\/div>$/g, ''),
			indexPath,
			props
		);

		return new Response(html, {
			headers: { 'Content-Type': 'text/html' }
		});
	} catch (error) {
		console.error('[SSR] Ember render error:', error);

		return new Response(ssrErrorPage('ember', error), {
			headers: { 'Content-Type': 'text/html' },
			status: 500
		});
	}
};
