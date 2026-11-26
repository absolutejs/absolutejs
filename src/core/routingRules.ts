/* Redirects, rewrites and response headers declared in config.
 *
 * Everything here is pure: patterns are compiled once, a request is a
 * pathname and a query string, and the answer is a value. The Elysia
 * plugin that acts on the answer is `plugins/routingRules.ts`; the static
 * exporter reads the same compiled rules to write `_redirects` and
 * `_headers`.
 *
 * The pattern language is the file router's, on purpose: literal
 * segments, `:name` for exactly one segment, and a final `*` for the
 * rest of the path (which may be empty, so `/docs/*` also matches
 * `/docs`). No regular expressions and no optional segments — a rule a
 * reader cannot evaluate in their head is a rule that redirects the
 * wrong page in production. A trailing slash on the request is ignored.
 *
 * Order: the first redirect that matches answers; failing that, the
 * first rewrite. Header rules are different — every rule that matches
 * applies, in order, a later one overriding an earlier one for the same
 * header. */

import type {
	HeaderRule,
	RedirectRule,
	RedirectStatus,
	RewriteRule,
	RoutingRulesConfig
} from '../../types/routingRules';

const DEFAULT_REDIRECT_STATUS: RedirectStatus = 308;
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];
const WILDCARD = '*';
const PARAM_PREFIX = ':';
/** Paths the framework serves for itself (health, vitals, the image
 *  endpoint, dev tooling). A project's `/*` rule must not move them. */
const INTERNAL_PREFIXES: readonly string[] = ['/__absolute/', '/_absolute/'];
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;
const EXTERNAL_URL = /^https?:\/\//i;

type Segment =
	{ kind: 'literal'; value: string } | { kind: 'param'; name: string };

type CompiledPattern = {
	segments: readonly Segment[];
	source: string;
	wildcard: boolean;
};

type PatternMatch = {
	params: Readonly<Record<string, string>>;
	/** What the final `*` matched, without a leading slash. */
	rest: string;
};

type CompiledRedirect = {
	from: CompiledPattern;
	status: RedirectStatus;
	to: string;
};

type CompiledRewrite = { from: CompiledPattern; to: string };

type CompiledHeaders = {
	headers: Readonly<Record<string, string>>;
	path: CompiledPattern;
};

export type CompiledRoutingRules = {
	headers: readonly CompiledHeaders[];
	redirects: readonly CompiledRedirect[];
	rewrites: readonly CompiledRewrite[];
};

export type RoutingDecision =
	| { kind: 'none' }
	| { kind: 'redirect'; location: string; status: RedirectStatus }
	| { kind: 'rewrite'; pathname: string; search: string };

const splitPath = (pathname: string) =>
	pathname.split('/').filter((part) => part !== '');

const toSegment = (part: string) => {
	const segment: Segment = part.startsWith(PARAM_PREFIX)
		? { kind: 'param', name: part.slice(PARAM_PREFIX.length) }
		: { kind: 'literal', value: part };

	return segment;
};

const compilePattern = (source: string) => {
	const parts = splitPath(source);
	const wildcard = parts.at(-1) === WILDCARD;
	const compiled: CompiledPattern = {
		segments: (wildcard ? parts.slice(0, -1) : parts).map(toSegment),
		source,
		wildcard
	};

	return compiled;
};

const safeDecode = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const segmentMatches = (segment: Segment, part: string | undefined) => {
	if (part === undefined) return false;
	if (segment.kind === 'param') return true;

	return segment.value === safeDecode(part);
};

export const matchPattern = (pattern: CompiledPattern, pathname: string) => {
	const parts = splitPath(pathname);
	const { segments, wildcard } = pattern;
	if (parts.length < segments.length) return null;
	if (!wildcard && parts.length !== segments.length) return null;
	if (
		!segments.every((segment, index) =>
			segmentMatches(segment, parts[index])
		)
	)
		return null;

	const params: Record<string, string> = {};
	segments.forEach((segment, index) => {
		if (segment.kind === 'param') params[segment.name] = parts[index] ?? '';
	});
	const match: PatternMatch = {
		params,
		rest: parts.slice(segments.length).join('/')
	};

	return match;
};

/* The destination with the match written in. Values go in as they came
 * out of the request path — still percent-encoded — so a slug with a
 * space or a slash in it arrives at the destination as the same slug. */
const fillPart = (part: string, match: PatternMatch) => {
	if (part === WILDCARD) return match.rest;
	if (!part.startsWith(PARAM_PREFIX)) return part;

	return match.params[part.slice(PARAM_PREFIX.length)] ?? part;
};

const fillPath = (path: string, match: PatternMatch) => {
	const filled = path
		.split('/')
		.map((part) => fillPart(part, match))
		.join('/');

	// An empty `*` leaves `/docs/` — the same page as `/docs`.
	return filled.length > 1 && filled.endsWith('/')
		? filled.slice(0, -1)
		: filled;
};

const splitDestination = (destination: string) => {
	const queryAt = destination.indexOf('?');
	const hashAt = destination.indexOf('#');
	const cuts = [queryAt, hashAt].filter((index) => index >= 0);
	const pathEnd = cuts.length > 0 ? Math.min(...cuts) : destination.length;
	const origin = EXTERNAL_URL.test(destination)
		? new URL(destination).origin
		: '';

	return {
		hasQuery: queryAt >= 0,
		origin,
		path: destination.slice(origin.length, pathEnd),
		suffix: destination.slice(pathEnd)
	};
};

/* A destination with no query of its own inherits the request's, so
 * `/old?ref=mail` lands on `/new?ref=mail`. One that names a query is
 * taken to mean it. */
const fillDestination = (
	destination: string,
	match: PatternMatch,
	search: string
) => {
	const { hasQuery, origin, path, suffix } = splitDestination(destination);
	const filledPath = fillPath(path === '' ? '/' : path, match);
	if (hasQuery || search === '') return `${origin}${filledPath}${suffix}`;

	return `${origin}${filledPath}${search}${suffix}`;
};

const isInternal = (pathname: string) =>
	INTERNAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));

const none: RoutingDecision = { kind: 'none' };

const redirectDecision = (
	rules: CompiledRoutingRules,
	pathname: string,
	search: string
) => {
	const hit = rules.redirects
		.map((rule) => ({ match: matchPattern(rule.from, pathname), rule }))
		.find((candidate) => candidate.match !== null);
	if (!hit?.match) return null;
	const decision: RoutingDecision = {
		kind: 'redirect',
		location: fillDestination(hit.rule.to, hit.match, search),
		status: hit.rule.status
	};

	return decision;
};

const rewriteDecision = (
	rules: CompiledRoutingRules,
	pathname: string,
	search: string
) => {
	const hit = rules.rewrites
		.map((rule) => ({ match: matchPattern(rule.from, pathname), rule }))
		.find((candidate) => candidate.match !== null);
	if (!hit?.match) return null;
	const target = fillDestination(hit.rule.to, hit.match, search);
	const queryAt = target.indexOf('?');
	const decision: RoutingDecision = {
		kind: 'rewrite',
		pathname: queryAt < 0 ? target : target.slice(0, queryAt),
		search: queryAt < 0 ? '' : target.slice(queryAt)
	};

	return decision;
};

/** What to do with a request for `pathname` (`search` includes its `?`). */
export const decideRouting = (
	rules: CompiledRoutingRules,
	pathname: string,
	search: string
) => {
	if (isInternal(pathname)) return none;

	return (
		redirectDecision(rules, pathname, search) ??
		rewriteDecision(rules, pathname, search) ??
		none
	);
};

/** The headers every matching rule adds, later rules overriding earlier. */
export const headersFor = (rules: CompiledRoutingRules, pathname: string) => {
	const merged: Record<string, string> = {};
	rules.headers
		.filter((rule) => matchPattern(rule.path, pathname) !== null)
		.forEach((rule) => Object.assign(merged, rule.headers));

	return merged;
};

/* ------------------------------------------------------------------ */
/* Validation. A rule that is wrong is refused when the server starts,
 * with every problem listed at once: a redirect that silently never
 * matches is found by a visitor, months later. */

const paramNames = (pattern: CompiledPattern) =>
	pattern.segments.flatMap((segment) =>
		segment.kind === 'param' ? [segment.name] : []
	);

const patternProblems = (label: string, source: string) => {
	if (typeof source !== 'string' || !source.startsWith('/'))
		return [`${label} must be a path starting with "/".`];
	const parts = splitPath(source);
	const names = parts
		.filter((part) => part.startsWith(PARAM_PREFIX))
		.map((part) => part.slice(PARAM_PREFIX.length));
	const problems: string[] = [];
	if (parts.slice(0, -1).includes(WILDCARD))
		problems.push(`${label} may use "*" only as its last segment.`);
	if (names.some((name) => name === ''))
		problems.push(`${label} has a ":" with no name after it.`);
	if (new Set(names).size !== names.length)
		problems.push(`${label} uses the same :name twice.`);

	return problems;
};

const destinationProblems = (
	label: string,
	from: string,
	destination: string,
	allowExternal: boolean
) => {
	if (typeof destination !== 'string' || destination === '')
		return [`${label} needs a destination.`];
	const external = EXTERNAL_URL.test(destination);
	if (external && !allowExternal)
		return [
			`${label} must be a path of this app; a rewrite cannot serve another site. Use a redirect, or proxy in a route.`
		];
	if (!external && !destination.startsWith('/'))
		return [`${label} must start with "/" or be a full http(s) URL.`];

	const pattern = compilePattern(from);
	const known = new Set(paramNames(pattern));
	const { path } = splitDestination(destination);
	const parts = path.split('/');
	const unknown = parts
		.filter((part) => part.startsWith(PARAM_PREFIX))
		.map((part) => part.slice(PARAM_PREFIX.length))
		.filter((name) => !known.has(name));
	const problems = unknown.map(
		(name) => `${label} uses :${name}, which "${from}" does not capture.`
	);
	if (parts.includes(WILDCARD) && !pattern.wildcard)
		problems.push(
			`${label} uses "*", but "${from}" has no "*" to fill it.`
		);

	return problems;
};

const redirectProblems = (rule: RedirectRule, index: number) => {
	const label = `redirects[${index}]`;
	const from = patternProblems(`${label}.from`, rule.from);
	if (from.length > 0) return from;
	const status =
		rule.status === undefined || REDIRECT_STATUSES.includes(rule.status)
			? []
			: [
					`${label}.status must be one of ${REDIRECT_STATUSES.join(', ')}, got ${String(rule.status)}.`
				];

	return [
		...status,
		...destinationProblems(`${label}.to`, rule.from, rule.to, true)
	];
};

const rewriteProblems = (rule: RewriteRule, index: number) => {
	const label = `rewrites[${index}]`;
	const from = patternProblems(`${label}.from`, rule.from);
	if (from.length > 0) return from;

	return destinationProblems(`${label}.to`, rule.from, rule.to, false);
};

const headerValueProblems = (label: string, name: string, value: unknown) => {
	if (!HEADER_NAME.test(name.toLowerCase()))
		return [`${label} has "${name}", which is not a valid header name.`];
	if (typeof value !== 'string')
		return [`${label}.${name} must be a string.`];
	if (/[\r\n]/.test(value))
		return [`${label}.${name} contains a line break.`];

	return [];
};

const headerProblems = (rule: HeaderRule, index: number) => {
	const label = `headers[${index}]`;
	const path = patternProblems(`${label}.path`, rule.path);
	if (path.length > 0) return path;
	const entries = Object.entries(rule.headers ?? {});
	if (entries.length === 0) return [`${label} sets no headers.`];

	return entries.flatMap(([name, value]) =>
		headerValueProblems(`${label}.headers`, name, value)
	);
};

/* A rule whose pattern an earlier rule already answers can never run. */
const shadowProblems = (kind: string, patterns: readonly string[]) =>
	patterns.flatMap((pattern, index) => {
		const earlier = patterns.indexOf(pattern);

		return earlier === index
			? []
			: [
					`${kind}[${index}] can never match: ${kind}[${earlier}] already answers "${pattern}".`
				];
	});

const MAX_REDIRECT_HOPS = 20;

/* Follows a path through the redirects, as a browser would. Only paths
 * the rules themselves produce are followed, so this finds a loop among
 * the rules (`/a` to `/b` to `/a`), not one that needs a particular
 * request to trigger. */
const loopFrom = (
	rules: CompiledRoutingRules,
	start: string,
	trail: readonly string[] = []
): readonly string[] | null => {
	if (trail.includes(start)) return [...trail, start];
	if (trail.length >= MAX_REDIRECT_HOPS) return null;
	const next = redirectDecision(rules, start, '');
	if (next?.kind !== 'redirect') return null;
	if (EXTERNAL_URL.test(next.location)) return null;

	return loopFrom(rules, next.location, [...trail, start]);
};

const isStaticPattern = (pattern: CompiledPattern) =>
	!pattern.wildcard && paramNames(pattern).length === 0;

const loopProblems = (rules: CompiledRoutingRules) => {
	const reported = new Set<string>();

	return rules.redirects
		.filter((rule) => isStaticPattern(rule.from))
		.flatMap((rule) => {
			const loop = loopFrom(rules, rule.from.source);
			if (loop === null) return [];
			const key = [...new Set(loop)].sort().join(' ');
			if (reported.has(key)) return [];
			reported.add(key);

			return [`redirects loop: ${loop.join(' -> ')}.`];
		});
};

const lowercaseHeaders = (headers: Record<string, string>) =>
	Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [
			name.toLowerCase(),
			value
		])
	);

const compile = (config: RoutingRulesConfig) => {
	const compiled: CompiledRoutingRules = {
		headers: (config.headers ?? []).map((rule) => ({
			headers: lowercaseHeaders(rule.headers),
			path: compilePattern(rule.path)
		})),
		redirects: (config.redirects ?? []).map((rule) => ({
			from: compilePattern(rule.from),
			status: rule.status ?? DEFAULT_REDIRECT_STATUS,
			to: rule.to
		})),
		rewrites: (config.rewrites ?? []).map((rule) => ({
			from: compilePattern(rule.from),
			to: rule.to
		}))
	};

	return compiled;
};

/** Every problem with the rules, or an empty list. */
export const compileRoutingRules = (config: RoutingRulesConfig) => {
	const problems = routingRuleProblems(config);
	if (problems.length > 0)
		throw new Error(
			`The redirects, rewrites and headers in the AbsoluteJS config have ${problems.length === 1 ? 'a problem' : 'problems'}:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`
		);

	return compile(config);
};
export const hasRoutingRules = (config: RoutingRulesConfig) =>
	(config.redirects?.length ?? 0) > 0 ||
	(config.rewrites?.length ?? 0) > 0 ||
	(config.headers?.length ?? 0) > 0;
export const routingRuleProblems = (config: RoutingRulesConfig) => {
	const redirects = config.redirects ?? [];
	const rewrites = config.rewrites ?? [];
	const shape = [
		...redirects.flatMap(redirectProblems),
		...rewrites.flatMap(rewriteProblems),
		...(config.headers ?? []).flatMap(headerProblems)
	];
	// Loops and shadowing are only meaningful among well-formed rules.
	if (shape.length > 0) return shape;

	return [
		...shadowProblems(
			'redirects',
			redirects.map((rule) => rule.from)
		),
		...shadowProblems(
			'rewrites',
			rewrites.map((rule) => rule.from)
		),
		...loopProblems(compile(config))
	];
};

/* ------------------------------------------------------------------ */
/* A static host runs no server, so `absolute export` cannot apply the
 * rules — but Netlify and Cloudflare Pages both read a `_redirects` and
 * a `_headers` file from the published directory, in one shared format.
 * `:name` means the same there; the final `*` is written `:splat` in a
 * destination; and a rewrite is a redirect with status 200. Hosts that
 * do not read these files (S3, GitHub Pages) ignore them. */

const SPLAT = ':splat';
const REWRITE_STATUS = 200;

const toHostDestination = (destination: string) =>
	destination
		.split('/')
		.map((part) => (part === WILDCARD ? SPLAT : part))
		.join('/');

const redirectLine = (from: string, destination: string, status: number) =>
	`${from} ${toHostDestination(destination)} ${status}`;

const headerBlock = (rule: HeaderRule) =>
	[
		rule.path,
		...Object.entries(rule.headers).map(
			([name, value]) => `  ${name}: ${value}`
		)
	].join('\n');

/** The `_redirects` and `_headers` files for a static host, each `null`
 *  when there is nothing to put in it. */
export const staticHostRuleFiles = (config: RoutingRulesConfig) => {
	compileRoutingRules(config);
	const lines = [
		...(config.redirects ?? []).map((rule) =>
			redirectLine(
				rule.from,
				rule.to,
				rule.status ?? DEFAULT_REDIRECT_STATUS
			)
		),
		...(config.rewrites ?? []).map((rule) =>
			redirectLine(rule.from, rule.to, REWRITE_STATUS)
		)
	];
	const blocks = (config.headers ?? []).map(headerBlock);

	return {
		headers: blocks.length > 0 ? `${blocks.join('\n\n')}\n` : null,
		redirects: lines.length > 0 ? `${lines.join('\n')}\n` : null
	};
};
