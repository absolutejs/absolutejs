import { NotFound } from 'elysia';
import type { SpaHost } from './spaRouteTypes';
import { isPageRequest, renderFirstNotFound } from './resolveConvention';
import { basename } from 'node:path';
import type { ConventionsMap } from '../../types/conventions';

const SPA_ROUTES_KEY = '__absoluteSpaRoutes';

export type RuntimeSpaHost = SpaHost & { framework: keyof ConventionsMap };

export const setSpaRouteManifest = (hosts: RuntimeSpaHost[]) => {
	Reflect.set(globalThis, SPA_ROUTES_KEY, hosts);
};

const isRuntimeSpaHost = (value: unknown): value is RuntimeSpaHost =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'framework') === 'string';

export const getSpaRouteManifest = () => {
	const value: unknown = Reflect.get(globalThis, SPA_ROUTES_KEY);

	return Array.isArray(value) ? value.filter(isRuntimeSpaHost) : [];
};

/* Routers whose mount path is only known per request (an Angular page's
 * colocated `export const routes`). Dev tracks them so a route edit is
 * reported. They don't enter `isKnownSpaRoute`, which reads only the
 * manifest above: the Angular page handler matches the page's runtime
 * `routes` against the request itself (see angular/colocatedRouteMatch). */
const OBSERVED_SPA_ROUTES_KEY = '__absoluteObservedSpaRoutes';

export const getObservedSpaRoutes = () => {
	const value: unknown = Reflect.get(globalThis, OBSERVED_SPA_ROUTES_KEY);

	return Array.isArray(value) ? value.filter(isRuntimeSpaHost) : [];
};

export const setObservedSpaRoutes = (hosts: RuntimeSpaHost[]) => {
	Reflect.set(globalThis, OBSERVED_SPA_ROUTES_KEY, hosts);
};

const normalizePath = (path: string) => {
	const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
	const trimmed = withLeadingSlash.replace(/\/+$/, '');

	return trimmed || '/';
};

const fullRoutePath = (baseHref: string, routePath: string) => {
	const base = normalizePath(baseHref);
	const route = normalizePath(routePath);
	if (base !== '/' && (route === base || route.startsWith(`${base}/`))) {
		return route;
	}
	if (base === '/') return route;

	return normalizePath(`${base}/${route.replace(/^\/+/, '')}`);
};

const routePattern = (path: string) => {
	const segments = normalizePath(path).split('/').filter(Boolean);
	let expression = '^';
	for (const segment of segments) {
		if (segment === '*' || segment === '**') {
			expression += '(?:/.*)?';
			continue;
		}
		const parameter = /^:[A-Za-z_$][A-Za-z0-9_$]*(?:\((.*)\))?(\?)?$/.exec(
			segment
		);
		if (parameter) {
			const valuePattern = parameter[1] || '[^/]+';
			expression += parameter[2]
				? `(?:/${valuePattern})?`
				: `/${valuePattern}`;
			continue;
		}
		expression += `/${segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}`;
	}

	return new RegExp(`${expression || '^/'}/?$`);
};

const sourcePageName = (sourceFile: string) =>
	basename(sourceFile)
		.replace(/\.[^.]+$/, '')
		.toLowerCase();

export const isKnownSpaRoute = (
	framework: keyof ConventionsMap,
	pageName: string,
	request: Request | undefined
) => {
	if (!request) return true;
	let pathname: string;
	try {
		pathname = normalizePath(new URL(request.url).pathname);
	} catch {
		return true;
	}

	const hosts = getSpaRouteManifest().filter((host) => {
		if (host.framework !== framework) return false;
		if (sourcePageName(host.sourceFile) !== pageName.toLowerCase())
			return false;
		const base = normalizePath(host.baseHref);

		return (
			base === '/' || pathname === base || pathname.startsWith(`${base}/`)
		);
	});
	if (hosts.length === 0) return true;

	return hosts.some((host) =>
		host.routes.some((route) =>
			routePattern(fullRoutePath(host.baseHref, route.path)).test(
				pathname
			)
		)
	);
};

export const renderSpaNotFound = async (
	framework: keyof ConventionsMap,
	pageName: string,
	request: Request | undefined
) => {
	if (isKnownSpaRoute(framework, pageName, request)) return null;

	return renderSpaNotFoundResponse(request);
};

/* The 404 an SPA host answers for a path none of its routes match. Like an
 * unknown Elysia route: a page navigation or HTMX request gets the
 * not-found convention page, any other client (a fetch asking for JSON)
 * gets Elysia's JSON 404. */
export const renderSpaNotFoundResponse = async (
	request: Request | undefined
) => {
	if (request && !isPageRequest(request)) {
		return new NotFound().toResponse();
	}

	return (
		(await renderFirstNotFound({
			preferHtmx: request?.headers.get('hx-request') === 'true'
		})) ??
		new Response('Not found', {
			headers: { 'Content-Type': 'text/plain' },
			status: 404
		})
	);
};
