import type { SpaHost } from './spaRouteTypes';
import { renderFirstNotFound } from './resolveConvention';
import { basename } from 'node:path';
import type { ConventionsMap } from '../../types/conventions';

const SPA_ROUTES_KEY = '__absoluteSpaRoutes';

export type RuntimeSpaHost = SpaHost & { framework: keyof ConventionsMap };

export const setSpaRouteManifest = (hosts: RuntimeSpaHost[]) => {
	Reflect.set(globalThis, SPA_ROUTES_KEY, hosts);
};

const getSpaRouteManifest = (): RuntimeSpaHost[] => {
	const value: unknown = Reflect.get(globalThis, SPA_ROUTES_KEY);

	return Array.isArray(value) ? (value as RuntimeSpaHost[]) : [];
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

	return (
		(await renderFirstNotFound()) ??
		new Response('Not found', {
			headers: { 'Content-Type': 'text/plain' },
			status: 404
		})
	);
};
