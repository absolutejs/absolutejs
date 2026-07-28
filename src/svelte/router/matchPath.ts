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
type RouteMatchBuilder = <Path extends string>(
	params: Record<string, string | undefined>
) => RouteMatchResult<ExtractRouteParams<Path>>;

const STATIC_SEGMENT_WEIGHT = 100;
const PARAM_SEGMENT_WEIGHT = 10;
const WILDCARD_SEGMENT_WEIGHT = 1;
const OPTIONAL_PENALTY = 1;
const buildRouteMatch: RouteMatchBuilder = (params) => ({
	matched: true,
	params: Object.assign(Object.create(null), params)
});

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
export const comparePatterns = (
	left: { score: number; index: number },
	right: { score: number; index: number }
) => {
	if (left.score !== right.score) return right.score - left.score;

	return left.index - right.index;
};
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

	return { score, segments };
};
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
export const matchPattern = <Path extends string>(
	pattern: CompiledPattern,
	pathname: string
): RouteMatchResult<ExtractRouteParams<Path>> => {
	const pathSegments = splitPath(pathname);
	const params: Record<string, string | undefined> = {};

	let pathIndex = 0;
	for (
		let segmentIndex = 0;
		segmentIndex < pattern.segments.length;
		segmentIndex++
	) {
		const segment = pattern.segments[segmentIndex];
		if (!segment) continue;

		if (segment.kind === 'wildcard') {
			params['wildcard'] = pathSegments.slice(pathIndex).join('/');

			return buildRouteMatch<Path>(params);
		}

		const candidate = pathSegments[pathIndex];

		if (candidate === undefined) {
			if (segment.kind === 'param' && segment.optional) {
				params[segment.name] = undefined;
				continue;
			}

			return { matched: false };
		}

		if (segment.kind === 'static') {
			if (segment.value !== candidate) return { matched: false };
			pathIndex++;
			continue;
		}

		// param
		params[segment.name] = candidate;
		pathIndex++;
	}

	if (pathIndex !== pathSegments.length) {
		return { matched: false };
	}

	return buildRouteMatch<Path>(params);
};
