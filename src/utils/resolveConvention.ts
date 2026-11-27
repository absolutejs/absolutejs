import { HTML_CONTENT_TYPE } from '../constants';
import { isDevelopmentRuntime } from './runtimeMode';
import { basename } from 'node:path';
import type { ConventionsMap, ErrorPageProps } from '../../types/conventions';
import { toPascal } from './stringModifiers';
import { nonceAttr, nonceSvelteHeadStyles, readCspNonce } from './cspNonceRef';
import { nonceStaticHtml } from '../core/staticHtmlNonce';
import { GENERIC_ERROR_MESSAGE } from './ssrErrorPage';
import { currentFileRoute } from './fileRouteRef';

// Use globalThis so the conventions map is shared across all bundles.
// The main bundle (dist/index.js) calls setConventions, but framework
// bundles (dist/svelte/index.js, etc.) need to read the same map.
const CONVENTIONS_KEY = '__absoluteConventions';

const isConventionsMap = (value: unknown): value is ConventionsMap =>
	Boolean(value) && typeof value === 'object';

const getMap = () => {
	const value: unknown = Reflect.get(globalThis, CONVENTIONS_KEY);
	if (isConventionsMap(value)) return value;

	const empty: ConventionsMap = {};

	return empty;
};

export const derivePageName = (pagePath: string) => {
	const base = basename(pagePath);
	// Strip hash and extension: "SvelteExample.abc123.js" → "SvelteExample"
	const dotIndex = base.indexOf('.');
	const name = dotIndex > 0 ? base.slice(0, dotIndex) : base;

	return toPascal(name);
};
export const getConventions = () => getMap();

/* The route-folder conventions of the file route this request is being
 * served by (fileRouteRef.ts), when it is one and has any. Route names
 * are unique across frameworks, so asking another framework's entry —
 * as the HTML fallback does — finds nothing. */
const routeFolderConventions = (framework: keyof ConventionsMap) => {
	const route = currentFileRoute();

	return route === undefined
		? undefined
		: getMap()[framework]?.routes?.[route];
};

const normalizeConventionPageName = (name: string) =>
	toPascal(name).replace(/\d+$/, '');

export const hasErrorConvention = (framework: keyof ConventionsMap) => {
	const conventions = getMap()[framework];
	if (!conventions) return false;
	if (conventions.defaults?.error) return true;

	return Object.values(conventions.pages ?? {}).some((page) =>
		Boolean(page.error)
	);
};
export const resolveErrorConventionPath = (
	framework: keyof ConventionsMap,
	pageName: string
) => {
	const conventions = getMap()[framework];
	if (!conventions) return undefined;

	const exact = conventions.pages?.[pageName]?.error;
	if (exact) return exact;
	// A file route's own: the nearest `error` in its route folder.
	const viaRoute = routeFolderConventions(framework)?.error;
	if (viaRoute) return viaRoute;

	const normalizedPageName = normalizeConventionPageName(pageName);
	for (const [candidate, page] of Object.entries(conventions.pages ?? {})) {
		if (normalizeConventionPageName(candidate) === normalizedPageName) {
			return page.error ?? conventions.defaults?.error;
		}
	}

	return conventions.defaults?.error;
};
export const resolveNotFoundConventionPath = (
	framework: keyof ConventionsMap
) => getMap()[framework]?.defaults?.notFound;
export const setConventions = (map: ConventionsMap) => {
	Reflect.set(globalThis, CONVENTIONS_KEY, map);
};

const isDev = () => isDevelopmentRuntime();

/* Outside development an error page gets a generic message and no stack.
 * Error messages routinely carry server details (a failed read names the
 * absolute path it tried, a database error names hosts and tables), and the
 * convention page renders them to whoever sent the request. The request
 * handler has already logged the full error on the server. */
const buildErrorProps = (error: unknown): ErrorPageProps => {
	const name = error instanceof Error ? error.name : 'Error';
	if (!isDev()) return { message: GENERIC_ERROR_MESSAGE, name };
	if (error instanceof Error) {
		return {
			message: error.message,
			name,
			...(error.stack ? { stack: error.stack } : {})
		};
	}

	return { message: String(error), name };
};

const renderReactError = async (
	conventionPath: string,
	errorProps: ErrorPageProps
) => {
	const { createElement } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const mod = await import(conventionPath);
	const ErrorComponent = mod.default;
	if (typeof ErrorComponent !== 'function') return null;

	const element = createElement(ErrorComponent, errorProps);
	const stream = await renderToReadableStream(element, {
		nonce: readCspNonce()
	});

	return new Response(stream, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 500
	});
};

const renderSvelteError = async (
	conventionPath: string,
	errorProps: ErrorPageProps
) => {
	const { render } = await import('svelte/server');
	const mod = await import(conventionPath);
	const ErrorComponent = mod.default;
	if (!ErrorComponent) return null;

	const nonce = readCspNonce();
	const { head, body } = render(ErrorComponent, {
		props: errorProps,
		...(nonce ? { csp: { nonce } } : {})
	});
	const html = `<!DOCTYPE html><html><head>${nonceSvelteHeadStyles(head)}</head><body>${body}</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 500
	});
};

const unescapeVueStyles = (ssrBody: string) => {
	let styles = '';
	const body = ssrBody.replace(
		/<style>([\s\S]*?)<\/style>/g,
		(_, css: string) => {
			styles += `<style${nonceAttr()}>${css
				.replace(/&quot;/g, '"')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')}</style>`;

			return '';
		}
	);

	return { body, styles };
};

const renderVueError = async (
	conventionPath: string,
	errorProps: ErrorPageProps
) => {
	const { createSSRApp, h } = await import('vue');
	const { renderToString } = await import('vue/server-renderer');
	const mod = await import(conventionPath);
	const ErrorComponent = mod.default;
	if (!ErrorComponent) return null;

	const app = createSSRApp({
		render: () => h(ErrorComponent, errorProps)
	});
	const rawBody = await renderToString(app);

	// Vue SSR escapes quotes inside <component is="style"> tags.
	// Extract style content, unescape it, and move to <head>.
	const { styles, body } = unescapeVueStyles(rawBody);
	const html = `<!DOCTYPE html><html><head>${styles}</head><body><div id="root">${body}</div></body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 500
	});
};

const renderAngularError = async (
	conventionPath: string,
	errorProps: ErrorPageProps
) => {
	// Angular convention error pages use the simple function-style renderer.
	// Class-style components (templateUrl/styleUrl trio) routed through the
	// full Angular SSR pipeline are tracked separately — see CLAUDE.md.
	const mod = await import(conventionPath);
	const renderFn = mod.default;
	if (typeof renderFn !== 'function') return null;

	const html = renderFn(errorProps);

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 500
	});
};

const escapeHtml = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

const replaceErrorTokens = (template: string, errorProps: ErrorPageProps) =>
	template
		.replace(/\{\{\s*name\s*\}\}/g, escapeHtml(errorProps.name))
		.replace(/\{\{\s*message\s*\}\}/g, escapeHtml(errorProps.message))
		.replace(
			/\{\{\s*stack\s*\}\}/g,
			errorProps.stack ? escapeHtml(errorProps.stack) : ''
		);

const renderHtmlError = async (
	conventionPath: string,
	errorProps: ErrorPageProps
) => {
	const template = await nonceStaticHtml(
		await Bun.file(conventionPath).text()
	);
	const html = replaceErrorTokens(template, errorProps);

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 500
	});
};

const logConventionRenderError = (
	framework: keyof ConventionsMap,
	label: string,
	renderError: unknown
) => {
	const message = renderError instanceof Error ? renderError.message : '';
	if (
		message.includes('Cannot find module') ||
		message.includes('Cannot find package') ||
		message.includes('not found in module')
	) {
		console.error(
			`[SSR] Convention ${label} page for ${framework} failed: missing framework package. ` +
				`Ensure the ${framework} runtime is installed (e.g. bun add ${framework === 'react' ? 'react react-dom' : framework}).`
		);

		return;
	}

	console.error(
		`[SSR] Failed to render ${framework} convention ${label} page:`,
		renderError
	);
};

// Phase 1 Ember adapter: convention pages aren't wired yet (no
// renderEmberError analog ships in v1). Returning null falls through to
// the generic ssrErrorPage. Phase 1.5 replaces this stub with a real
// renderer once the convention scanner knows about .gjs/.gts files.
const renderEmberError = async () => null;
const renderEmberNotFound = async () => null;

const ERROR_RENDERERS: Record<
	keyof ConventionsMap,
	(
		conventionPath: string,
		errorProps: ErrorPageProps
	) => Promise<Response | null>
> = {
	angular: renderAngularError,
	ember: renderEmberError,
	html: renderHtmlError,
	htmx: renderHtmlError,
	react: renderReactError,
	svelte: renderSvelteError,
	vue: renderVueError
};

const tryFrameworkErrorConvention = async (
	framework: keyof ConventionsMap,
	pageName: string,
	errorProps: ErrorPageProps,
	error: unknown
) => {
	let conventionPath = resolveErrorConventionPath(framework, pageName);
	if (!conventionPath && error instanceof Error && error.stack) {
		for (const match of error.stack.matchAll(
			/^\s*at\s+([A-Za-z_$][\w$]*)/gm
		)) {
			const [, candidate] = match;
			if (!candidate) continue;

			conventionPath = resolveErrorConventionPath(framework, candidate);
			if (conventionPath) break;
		}
	}
	if (!conventionPath) return null;

	const renderer = ERROR_RENDERERS[framework];
	if (!renderer) return null;

	try {
		return await renderer(conventionPath, errorProps);
	} catch (renderError) {
		logConventionRenderError(framework, 'error', renderError);
	}

	return null;
};

/* Whether a request is a page navigation or an HTMX request, the only
 * requests the HTML error and not-found conventions answer (see
 * renderStaticRouteError below). A fetch or API client asking for JSON gets
 * Elysia's JSON response, not an HTML page. */
export const isPageRequest = (request: Request) => {
	if (request.headers.get('hx-request') === 'true') return true;
	if (request.headers.get('sec-fetch-dest') === 'document') return true;

	return (request.headers.get('accept') ?? '').includes('text/html');
};

export const renderConventionError = async (
	framework: keyof ConventionsMap,
	pageName: string,
	error: unknown
) => {
	const errorProps = buildErrorProps(error);

	const frameworkResponse = await tryFrameworkErrorConvention(
		framework,
		pageName,
		errorProps,
		error
	);
	if (frameworkResponse) return frameworkResponse;

	// Universal fallback: any project can ship a plain `error.html` in
	// the html pages dir as the last-resort branded error page before
	// the inline ssrErrorPage() takes over.
	if (framework !== 'html') {
		const htmlResponse = await tryFrameworkErrorConvention(
			'html',
			pageName,
			errorProps,
			error
		);
		if (htmlResponse) return htmlResponse;
	}

	return null;
};

/* An error thrown by a route handler (not by a page handler, which renders
 * its own error page) reaches Elysia's onError. When the request is a page
 * navigation or an HTMX request and the project ships an HTML or HTMX
 * error.html, render that instead of Elysia's JSON 500. HTMX requests try
 * the HTMX directory's error.html first. Outside development
 * buildErrorProps gives the page a generic message and no stack, so no file
 * paths or internals leak. */

export const renderStaticRouteError = async (
	request: Request,
	error: unknown
) => {
	if (!isPageRequest(request)) return null;
	const preferHtmx = request.headers.get('hx-request') === 'true';
	const order: ('html' | 'htmx')[] = preferHtmx
		? ['htmx', 'html']
		: ['html', 'htmx'];
	const frameworks = order.filter((framework) =>
		hasErrorConvention(framework)
	);
	if (frameworks.length === 0) return null;

	const errorProps = buildErrorProps(error);
	const renderNext = async (
		remaining: ('html' | 'htmx')[]
	): Promise<Response | null> => {
		const [framework, ...rest] = remaining;
		if (!framework) return null;
		const response = await tryFrameworkErrorConvention(
			framework,
			'',
			errorProps,
			// Per-page conventions are matched from the original stack.
			error
		);

		return response ?? renderNext(rest);
	};

	return renderNext(frameworks);
};

const renderReactNotFound = async (conventionPath: string) => {
	const { createElement } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const mod = await import(conventionPath);
	const NotFoundComponent = mod.default;
	if (typeof NotFoundComponent !== 'function') return null;

	const element = createElement(NotFoundComponent);
	const stream = await renderToReadableStream(element, {
		nonce: readCspNonce()
	});

	return new Response(stream, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 404
	});
};

const renderSvelteNotFound = async (conventionPath: string) => {
	const { render } = await import('svelte/server');
	const mod = await import(conventionPath);
	const NotFoundComponent = mod.default;
	if (!NotFoundComponent) return null;

	const nonce = readCspNonce();
	const { head, body } = render(
		NotFoundComponent,
		nonce ? { csp: { nonce } } : {}
	);
	const html = `<!DOCTYPE html><html><head>${nonceSvelteHeadStyles(head)}</head><body>${body}</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 404
	});
};

const renderVueNotFound = async (conventionPath: string) => {
	const { createSSRApp, h } = await import('vue');
	const { renderToString } = await import('vue/server-renderer');
	const mod = await import(conventionPath);
	const NotFoundComponent = mod.default;
	if (!NotFoundComponent) return null;

	const app = createSSRApp({
		render: () => h(NotFoundComponent)
	});
	const rawBody = await renderToString(app);

	const { styles, body } = unescapeVueStyles(rawBody);
	const html = `<!DOCTYPE html><html><head>${styles}</head><body><div id="root">${body}</div></body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 404
	});
};

const renderAngularNotFound = async (conventionPath: string) => {
	const mod = await import(conventionPath);
	const renderFn = mod.default;
	if (typeof renderFn !== 'function') return null;

	const html = renderFn();

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 404
	});
};

const renderHtmlNotFound = async (conventionPath: string) => {
	const html = await nonceStaticHtml(await Bun.file(conventionPath).text());

	return new Response(html, {
		headers: { 'Content-Type': HTML_CONTENT_TYPE },
		status: 404
	});
};

const NOT_FOUND_RENDERERS: Record<
	keyof ConventionsMap,
	(conventionPath: string) => Promise<Response | null>
> = {
	angular: renderAngularNotFound,
	ember: renderEmberNotFound,
	html: renderHtmlNotFound,
	htmx: renderHtmlNotFound,
	react: renderReactNotFound,
	svelte: renderSvelteNotFound,
	vue: renderVueNotFound
};

const renderNotFoundAt = async (
	framework: keyof ConventionsMap,
	conventionPath: string | undefined
) => {
	if (!conventionPath) return null;

	const renderer = NOT_FOUND_RENDERERS[framework];
	if (!renderer) return null;

	try {
		return await renderer(conventionPath);
	} catch (renderError) {
		logConventionRenderError(framework, 'not-found', renderError);
	}

	return null;
};

export const renderConventionNotFound = async (
	framework: keyof ConventionsMap
) => renderNotFoundAt(framework, resolveNotFoundConventionPath(framework));

/* `/blog/:slug` as the start of an address: that folder, and anything
 * below it. A catch-all folder is the folder it is in. */
const folderPattern = (path: string) => {
	const segments = path
		.split('/')
		.filter(Boolean)
		.filter((segment) => segment !== '*');
	const source = segments
		.map((segment) =>
			segment.startsWith(':')
				? '/[^/]+'
				: `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
		)
		.join('');

	return {
		depth: segments.length,
		literal: segments.filter((segment) => !segment.startsWith(':')).length,
		pattern: new RegExp(`^${source}(?:/.*)?$`)
	};
};

type FolderMatch = {
	depth: number;
	framework: keyof ConventionsMap;
	literal: number;
	notFound: string;
};

/* Deepest folder first; between two as deep, the one that names more of
 * the address outright. */
const closerFolder = (left: FolderMatch, right: FolderMatch) =>
	right.depth - left.depth || right.literal - left.literal;

const matchFolder = (
	framework: string,
	folder: { notFound: string; path: string },
	pathname: string
) => {
	const { depth, literal, pattern } = folderPattern(folder.path);
	if (!pattern.test(pathname) || !isConventionFramework(framework)) return [];
	const match: FolderMatch = {
		depth,
		framework,
		literal,
		notFound: folder.notFound
	};

	return [match];
};

const foldersFor = (pathname: string) =>
	Object.entries(getMap())
		.flatMap(([framework, entry]) =>
			(entry?.folders ?? []).flatMap((folder) =>
				matchFolder(framework, folder, pathname)
			)
		)
		.sort(closerFolder);

/** The `not-found` of the route folder an address falls under, for an
 *  address that no route answers: `routes/blog/not-found` for
 *  `/blog/anything`. The deepest folder that has one. `null` when no
 *  folder above the address does, and the app-wide one is next. */
export const renderFolderNotFound = async (pathname: string) => {
	const renderNext = async (
		remaining: FolderMatch[]
	): Promise<Response | null> => {
		const [folder, ...rest] = remaining;
		if (!folder) return null;
		const response = await renderNotFoundAt(
			folder.framework,
			folder.notFound
		);

		return response ?? renderNext(rest);
	};

	return renderNext(foldersFor(pathname));
};

/** The `not-found` of the file route this request is being served by:
 *  the nearest one in its route folder. For a route whose `load` threw
 *  `NotFound`. `null` when its folders have none. */
export const renderRouteNotFound = async (framework: keyof ConventionsMap) =>
	renderNotFoundAt(framework, routeFolderConventions(framework)?.notFound);

const CONVENTION_FRAMEWORKS = new Set<string>([
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);

const isConventionFramework = (
	framework: string
): framework is keyof ConventionsMap => CONVENTION_FRAMEWORKS.has(framework);

const NOT_FOUND_PRIORITY: (keyof ConventionsMap)[] = [
	'react',
	'svelte',
	'vue',
	'angular',
	'html',
	'htmx'
];

/** Renders the first available not-found convention. An HTMX request
 *  (`HX-Request` header) tries the HTMX pages directory's not-found.html
 *  first, so an HTMX swap gets HTMX markup. */
/* ------------------------------------------------------------------ */

/* The `loading` convention, rendered once as a FRAGMENT.
 *
 * It is not a page: the navigation layer shows it over the live document
 * while a soft navigation is in flight, so it has to be insertable markup
 * rather than a document. A component's styles are concatenated ahead of
 * its body — a `<style>` is legal in `<body>`, and the alternative is
 * asking every loading convention to inline its own styles.
 *
 * Rendered on demand and cached by the route that serves it, so the cost
 * is one render per process rather than one per navigation. */
export const resolveLoadingConventionPath = (framework: keyof ConventionsMap) =>
	getMap()[framework]?.defaults?.loading;

const renderReactLoading = async (conventionPath: string) => {
	const { createElement } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const mod = await import(conventionPath);
	const LoadingComponent = mod.default;
	if (typeof LoadingComponent !== 'function') return null;

	const stream = await renderToReadableStream(
		createElement(LoadingComponent)
	);

	return new Response(stream).text();
};

const renderSvelteLoading = async (conventionPath: string) => {
	const { render } = await import('svelte/server');
	const mod = await import(conventionPath);
	const LoadingComponent = mod.default;
	if (!LoadingComponent) return null;
	const { head, body } = render(LoadingComponent, {});

	return `${nonceSvelteHeadStyles(head)}${body}`;
};

const renderVueLoading = async (conventionPath: string) => {
	const { createSSRApp, h: createVNode } = await import('vue');
	const { renderToString } = await import('vue/server-renderer');
	const mod = await import(conventionPath);
	const LoadingComponent = mod.default;
	if (!LoadingComponent) return null;
	const app = createSSRApp({
		render: () => createVNode(LoadingComponent)
	});
	const { styles, body } = unescapeVueStyles(await renderToString(app));

	return `${styles}${body}`;
};

const renderAngularLoading = async (conventionPath: string) => {
	const mod = await import(conventionPath);
	const renderFn = mod.default;
	if (typeof renderFn !== 'function') return null;

	return String(renderFn());
};

/* An HTML or HTMX loading convention is used as written. A full document
 * would be nonsense inside a live page, so only what a `<body>` holds is
 * taken when the file happens to be one. */
const renderHtmlLoading = async (conventionPath: string) => {
	const html = await nonceStaticHtml(await Bun.file(conventionPath).text());
	const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);

	return body?.[1] ?? html;
};

const LOADING_RENDERERS: Record<
	keyof ConventionsMap,
	(conventionPath: string) => Promise<string | null>
> = {
	angular: renderAngularLoading,
	html: renderHtmlLoading,
	htmx: renderHtmlLoading,
	react: renderReactLoading,
	svelte: renderSvelteLoading,
	vue: renderVueLoading,
	ember: async () => null
};

/* The per-framework renderers stamp the REQUEST's CSP nonce onto any
 * style they emit, which is correct for an error page rendered per
 * request and wrong for a fragment cached for the life of the process:
 * every later page carries a different nonce, and a strict CSP would
 * block the style from the second navigation on. The nonce is stripped
 * here and re-applied by the navigation layer from the live document
 * (`applyNonce`), which is the only place that knows the current one. */
const stripNonces = (html: string) => html.replace(/\snonce="[^"]*"/g, '');

/** The first `loading` convention any configured framework ships, as
 *  insertable markup. `null` when the app has none. */
export const renderFirstLoadingFragment = async () => {
	const renderNext = async (
		frameworks: (keyof ConventionsMap)[]
	): Promise<string | null> => {
		const [framework, ...remaining] = frameworks;
		if (!framework) return null;
		const conventionPath = resolveLoadingConventionPath(framework);
		if (!conventionPath) return renderNext(remaining);
		try {
			const fragment = await LOADING_RENDERERS[framework](conventionPath);
			if (fragment !== null && fragment.trim() !== '')
				return stripNonces(fragment);
		} catch (renderError) {
			logConventionRenderError(framework, 'loading', renderError);
		}

		return renderNext(remaining);
	};

	return renderNext([...NOT_FOUND_PRIORITY]);
};

export const renderFirstNotFound = async (
	options: { preferHtmx?: boolean } = {}
) => {
	const renderNext = async (frameworks: (keyof ConventionsMap)[]) => {
		const [framework, ...remaining] = frameworks;
		if (!framework) {
			return null;
		}
		if (!getMap()[framework]?.defaults?.notFound) {
			return renderNext(remaining);
		}

		const response = await renderConventionNotFound(framework);
		if (response) {
			return response;
		}

		return renderNext(remaining);
	};

	return renderNext(
		options.preferHtmx
			? ['htmx', ...NOT_FOUND_PRIORITY.filter((key) => key !== 'htmx')]
			: NOT_FOUND_PRIORITY
	);
};

/** One route folder's `loading`, rendered: the address the folder
 *  stands for, and the markup. */
export type FolderLoadingFragment = { html: string; path: string };

/** Every `loading` the app has, rendered: the app-wide one, and each
 *  route folder's. */
export type LoadingSet = {
	fallback: string | null;
	folders: FolderLoadingFragment[];
};

const renderLoadingAt = async (
	framework: keyof ConventionsMap,
	conventionPath: string
) => {
	try {
		const fragment = await LOADING_RENDERERS[framework](conventionPath);

		return fragment !== null && fragment.trim() !== ''
			? stripNonces(fragment)
			: null;
	} catch (renderError) {
		logConventionRenderError(framework, 'loading', renderError);

		return null;
	}
};

const renderFolderLoading = async (
	framework: string,
	folder: { loading: string; path: string }
) => {
	if (!isConventionFramework(framework)) return [];
	const html = await renderLoadingAt(framework, folder.loading);
	if (html === null) return [];
	const fragment: FolderLoadingFragment = { html, path: folder.path };

	return [fragment];
};

/** All of the app's `loading` conventions as insertable markup: the one
 *  in `pages/`, and each route folder's with the address it covers
 *  (`routes/dashboard/loading` for `/dashboard/**`). The navigation
 *  layer fetches the set once and picks, for each navigation, the
 *  deepest folder its destination falls under. */
export const renderLoadingSet = async () => {
	const perFolder = await Promise.all(
		Object.entries(getMap()).flatMap(([framework, entry]) =>
			(entry?.loadingFolders ?? []).map((folder) =>
				renderFolderLoading(framework, folder)
			)
		)
	);
	const set: LoadingSet = {
		fallback: await renderFirstLoadingFragment(),
		folders: perFolder.flat()
	};

	return set;
};
