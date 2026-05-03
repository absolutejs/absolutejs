import type {
	ExtractRouteParams,
	RouteMatchResult
} from '../../../types/svelteRouter';

type CompiledSegment =
	| { kind: 'static'; value: string }
	| { kind: 'param'; name: string; optional: boolean }
	| { kind: 'wildcard' };

type CompiledPattern = {
	segments: CompiledSegment[];
	score: number;
};

const STATIC_SEGMENT_WEIGHT = 100;
const PARAM_SEGMENT_WEIGHT = 10;
const WILDCARD_SEGMENT_WEIGHT = 1;
const OPTIONAL_PENALTY = 1;

const splitPath = (path: string) => {
	const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '');
	if (trimmed === '') return [];

	return trimmed.split('/');
};

const compileSegment = (raw: string): CompiledSegment => {
	if (raw === '*' || raw.startsWith('*')) {
		return { kind: 'wildcard' };
	}

	if (raw.startsWith(':')) {
		const body = raw.slice(1);
		const optional = body.endsWith('?');
		const name = optional ? body.slice(0, -1) : body;

		return { kind: 'param', name, optional };
	}

	return { kind: 'static', value: raw };
};

/**
 * Compile a `<Route path>` pattern into segments + a specificity score.
 * Higher score = more specific (longer static prefix beats parameterised).
 */
export const compilePattern = (pattern: string): CompiledPattern => {
	const segments = splitPath(pattern).map(compileSegment);

	let score = 0;
	for (const segment of segments) {
		if (segment.kind === 'static') score += STATIC_SEGMENT_WEIGHT;
		else if (segment.kind === 'param') {
			score += PARAM_SEGMENT_WEIGHT;
			if (segment.optional) score -= OPTIONAL_PENALTY;
		} else if (segment.kind === 'wildcard')
			score += WILDCARD_SEGMENT_WEIGHT;
	}

	return { segments, score };
};

/**
 * Match a URL pathname against a compiled pattern. Returns the extracted
 * params on a successful match, or a miss otherwise.
 */
export const matchPattern = <Path extends string>(
	pattern: CompiledPattern,
	pathname: string
): RouteMatchResult<ExtractRouteParams<Path>> => {
	const pathSegments = splitPath(pathname);
	const params: Record<string, string | undefined> = {};

	let pi = 0;
	for (let si = 0; si < pattern.segments.length; si++) {
		const segment = pattern.segments[si];
		if (!segment) continue;

		if (segment.kind === 'wildcard') {
			params['wildcard'] = pathSegments.slice(pi).join('/');
			return {
				matched: true,
				params: params as ExtractRouteParams<Path>
			};
		}

		const candidate = pathSegments[pi];

		if (candidate === undefined) {
			if (segment.kind === 'param' && segment.optional) {
				params[segment.name] = undefined;
				continue;
			}

			return { matched: false };
		}

		if (segment.kind === 'static') {
			if (segment.value !== candidate) return { matched: false };
			pi++;
			continue;
		}

		// param
		params[segment.name] = candidate;
		pi++;
	}

	if (pi !== pathSegments.length) {
		return { matched: false };
	}

	return {
		matched: true,
		params: params as ExtractRouteParams<Path>
	};
};

/**
 * Stable comparator for compiled patterns. Higher specificity sorts first.
 * When two patterns have equal score, declaration order (the original index)
 * decides — passed in via the `index` field on each entry.
 */
export const comparePatterns = (
	a: { score: number; index: number },
	b: { score: number; index: number }
) => {
	if (a.score !== b.score) return b.score - a.score;

	return a.index - b.index;
};

/**
 * Join a basepath stack with a child pattern, producing an absolute pattern
 * that the route matcher can compile against an incoming pathname.
 *
 * Handles slash edge cases:
 *   joinBasepath('', '/users')           → '/users'
 *   joinBasepath('/portal', '/users')    → '/portal/users'
 *   joinBasepath('/portal/', '/users')   → '/portal/users'
 *   joinBasepath('/portal', 'users')     → '/portal/users'
 *   joinBasepath('/portal', '/')         → '/portal'
 */
export const joinBasepath = (basepath: string, pattern: string) => {
	const trimmedBase = basepath.replace(/\/+$/, '');
	const trimmedPattern = pattern.replace(/^\/+/, '');

	if (trimmedPattern === '') {
		return trimmedBase === '' ? '/' : trimmedBase;
	}

	if (trimmedBase === '') {
		return `/${trimmedPattern}`;
	}

	return `${trimmedBase}/${trimmedPattern}`;
};
