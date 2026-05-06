import { basename } from 'node:path';
import type { ConventionsMap, ErrorPageProps } from '../../types/conventions';
import { toPascal } from './stringModifiers';

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

const normalizeConventionPageName = (name: string) =>
	toPascal(name).replace(/\d+$/, '');

export const resolveErrorConventionPath = (
	framework: keyof ConventionsMap,
	pageName: string
) => {
	const conventions = getMap()[framework];
	if (!conventions) return undefined;

	const exact = conventions.pages?.[pageName]?.error;
	if (exact) return exact;

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

export const hasErrorConvention = (framework: keyof ConventionsMap) => {
	const conventions = getMap()[framework];
	if (!conventions) return false;
	if (conventions.defaults?.error) return true;

	return Object.values(conventions.pages ?? {}).some((page) =>
		Boolean(page.error)
	);
};

export const setConventions = (map: ConventionsMap) => {
	Reflect.set(globalThis, CONVENTIONS_KEY, map);
};

const isDev = () => process.env.NODE_ENV === 'development';

const buildErrorProps = (error: unknown): ErrorPageProps => {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			...(isDev() && error.stack ? { stack: error.stack } : {})
		};
	}

	return { name: 'Error', message: String(error) };
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
	const stream = await renderToReadableStream(element);

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' },
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

	const { head, body } = render(ErrorComponent, {
		props: errorProps
	});
	const html = `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' },
		status: 500
	});
};

const unescapeVueStyles = (ssrBody: string) => {
	let styles = '';
	const body = ssrBody.replace(
		/<style>([\s\S]*?)<\/style>/g,
		(_, css: string) => {
			styles += `<style>${css
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
		headers: { 'Content-Type': 'text/html' },
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
		headers: { 'Content-Type': 'text/html' },
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
	const template = await Bun.file(conventionPath).text();
	const html = replaceErrorTokens(template, errorProps);

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' },
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
			const candidate = match[1];
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

const renderReactNotFound = async (conventionPath: string) => {
	const { createElement } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const mod = await import(conventionPath);
	const NotFoundComponent = mod.default;
	if (typeof NotFoundComponent !== 'function') return null;

	const element = createElement(NotFoundComponent);
	const stream = await renderToReadableStream(element);

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' },
		status: 404
	});
};

const renderSvelteNotFound = async (conventionPath: string) => {
	const { render } = await import('svelte/server');
	const mod = await import(conventionPath);
	const NotFoundComponent = mod.default;
	if (!NotFoundComponent) return null;

	const { head, body } = render(NotFoundComponent);
	const html = `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' },
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
		headers: { 'Content-Type': 'text/html' },
		status: 404
	});
};

const renderAngularNotFound = async (conventionPath: string) => {
	const mod = await import(conventionPath);
	const renderFn = mod.default;
	if (typeof renderFn !== 'function') return null;

	const html = renderFn();

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' },
		status: 404
	});
};

const renderHtmlNotFound = async (conventionPath: string) => {
	const html = await Bun.file(conventionPath).text();

	return new Response(html, {
		headers: { 'Content-Type': 'text/html' },
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
	react: renderReactNotFound,
	svelte: renderSvelteNotFound,
	vue: renderVueNotFound
};

export const renderConventionNotFound = async (
	framework: keyof ConventionsMap
) => {
	const conventionPath = resolveNotFoundConventionPath(framework);
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

const NOT_FOUND_PRIORITY: (keyof ConventionsMap)[] = [
	'react',
	'svelte',
	'vue',
	'angular',
	'html'
];

export const renderFirstNotFound = async () => {
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

	return renderNext(NOT_FOUND_PRIORITY);
};
