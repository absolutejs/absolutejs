import { basename } from 'node:path';
import type { ConventionsMap } from '../../types/conventions';
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
export const resolveErrorConventionPath = (
	framework: keyof ConventionsMap,
	pageName: string
) => {
	const conventions = getMap()[framework];
	if (!conventions) return undefined;

	return conventions.pages?.[pageName]?.error ?? conventions.defaults?.error;
};
export const resolveNotFoundConventionPath = (
	framework: keyof ConventionsMap
) => getMap()[framework]?.defaults?.notFound;
export const setConventions = (map: ConventionsMap) => {
	Reflect.set(globalThis, CONVENTIONS_KEY, map);
};

const isDev = () => process.env.NODE_ENV === 'development';

const buildErrorProps = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	const stack = isDev() && error instanceof Error ? error.stack : undefined;

	return { error: { message, stack } };
};

const renderReactError = async (
	conventionPath: string,
	errorProps: ReturnType<typeof buildErrorProps>
) => {
	const { createElement } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const mod = await import(conventionPath);
	const [firstKey] = Object.keys(mod);
	const ErrorComponent =
		mod.default ?? (firstKey ? mod[firstKey] : undefined);
	const element = createElement(ErrorComponent, errorProps);
	const stream = await renderToReadableStream(element);

	return new Response(stream, {
		headers: { 'Content-Type': 'text/html' },
		status: 500
	});
};

const renderSvelteError = async (
	conventionPath: string,
	errorProps: ReturnType<typeof buildErrorProps>
) => {
	const { render } = await import('svelte/server');
	const mod = await import(conventionPath);
	const ErrorComponent = mod.default;
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
	errorProps: ReturnType<typeof buildErrorProps>
) => {
	const { createSSRApp, h } = await import('vue');
	const { renderToString } = await import('vue/server-renderer');
	const mod = await import(conventionPath);
	const ErrorComponent = mod.default;
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
	errorProps: ReturnType<typeof buildErrorProps>
) => {
	// Angular error pages are rendered as plain HTML templates
	// since the full Angular SSR pipeline is too heavy for error pages
	const mod = await import(conventionPath);
	const renderError = mod.default ?? mod.renderError;
	if (typeof renderError !== 'function') return null;

	const html = renderError(errorProps);

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

const ERROR_RENDERERS: Record<
	keyof ConventionsMap,
	(
		conventionPath: string,
		errorProps: ReturnType<typeof buildErrorProps>
	) => Promise<Response | null>
> = {
	angular: renderAngularError,
	react: renderReactError,
	svelte: renderSvelteError,
	vue: renderVueError
};

export const renderConventionError = async (
	framework: keyof ConventionsMap,
	pageName: string,
	error: unknown
) => {
	const conventionPath = resolveErrorConventionPath(framework, pageName);
	if (!conventionPath) return null;

	const errorProps = buildErrorProps(error);
	const renderer = ERROR_RENDERERS[framework];
	if (!renderer) return null;

	try {
		return await renderer(conventionPath, errorProps);
	} catch (renderError) {
		logConventionRenderError(framework, 'error', renderError);
	}

	return null;
};

const renderReactNotFound = async (conventionPath: string) => {
	const { createElement } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const mod = await import(conventionPath);
	const [nfKey] = Object.keys(mod);
	const NotFoundComponent = mod.default ?? (nfKey ? mod[nfKey] : undefined);
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
	const renderNotFound = mod.default ?? mod.renderNotFound;
	if (typeof renderNotFound !== 'function') return null;

	const html = renderNotFound();

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
	'angular'
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
