import type { AbsoluteMobileCompatibilityRoute } from './releaseArtifact';

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

const routeSegmentPattern = (segment: string) => {
	if (segment === '*') return '.*';
	if (segment.startsWith(':') && segment.endsWith('?')) return '[^/]*';
	if (segment.startsWith(':')) return '[^/]+';

	return segment.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');
};

export const matchesAbsoluteMobileRoutePattern = (
	pattern: string,
	pathname: string
) => {
	const expression = pattern.split('/').map(routeSegmentPattern).join('/');

	return new RegExp(`^${expression}/?$`).test(pathname);
};

export const resolveAbsoluteMobileRoute = (
	routes: readonly AbsoluteMobileCompatibilityRoute[],
	pathname: string,
	method: 'GET' | 'HEAD' = 'GET'
) =>
	routes.find(
		(route) =>
			route.method === method &&
			matchesAbsoluteMobileRoutePattern(route.pattern, pathname)
	);
