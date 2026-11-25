import { isProxyTrusted } from '../utils/requestOrigin';
/* Rate limiting, as an Elysia plugin.
 *
 * What is limited by default, and what deliberately is not.
 *
 * The vitals endpoint IS limited by default. It is an unauthenticated POST
 * sink the framework mounts on the app's behalf, so leaving it open is the
 * framework's omission rather than the app's choice. Plan item 5.16 names
 * it for that reason.
 *
 * The health endpoints are NOT, and must not be. A 429 to a readiness
 * probe is a failed probe, and a failed readiness probe takes the process
 * out of rotation — so a limit there turns a burst of probes into an
 * outage. Their amplification problem is solved where it belongs instead:
 * `runHealthChecks` caches its report for a second and collapses
 * concurrent probes onto one run, so 500 requests cost one check rather
 * than 500 (measured) without refusing anybody.
 *
 * That exemption has to be explicit, which a test caught: a global `limit`
 * covers every path no rule names, so the first version of this limited
 * `/__absolute/ready` for any project that set one — the exact outage
 * described above, shipped by the thing documenting it. `exemptPaths`
 * holds those paths out of the fallback. An explicit rule naming one still
 * wins: a project that means to limit its own probes may.
 *
 * App routes are not limited unless asked for. A framework that starts
 * refusing a project's traffic on its own, at a number it picked, is worse
 * than one that does nothing.
 *
 * Per process, which is honest rather than ideal: two instances behind a
 * load balancer each allow the configured rate. Shared counting needs the
 * store that clustering (plan item 5.9) has to settle first. */

import { Elysia } from 'elysia';
import {
	clientKeyFor,
	createRateLimiter,
	type RateLimitDecision
} from '../core/rateLimit';
import type { RateLimitConfig } from '../../types/rateLimit';

const DEFAULT_WINDOW_MS = 60_000;
const TOO_MANY_REQUESTS = 429;

/** Requests a minute for the vitals sink, per client. A real page sends
 *  one batch per load, so this is generous for a browser and useless as an
 *  amplifier. */
const VITALS_DEFAULT_LIMIT = 60;

/** The vitals summary needs its own rule, and not because it deserves a
 *  looser one. The default summary path sits UNDER the batch endpoint's
 *  path, so longest-prefix matching would otherwise hand it the batch
 *  rule — and a dev overlay polling once a second would both exhaust the
 *  60/min meant for page loads and share a bucket with them, so reading the
 *  numbers would refuse the reports that produce them. Reading a histogram
 *  already in memory is cheap; this is a ceiling, not a budget. */
const VITALS_SUMMARY_DEFAULT_LIMIT = 600;

type ResolvedRule = {
	limit: number;
	path: string;
	windowMs: number;
};

const ruleFor = (rules: readonly ResolvedRule[], path: string) => {
	let matched: ResolvedRule | undefined = undefined;
	for (const rule of rules) {
		if (!path.startsWith(rule.path)) continue;
		/* Longest prefix wins, so a stricter `/api/upload` is not masked
		 * by a looser `/api`. */
		if (matched === undefined || rule.path.length > matched.path.length)
			matched = rule;
	}

	return matched;
};

const resolveRules = (
	config: RateLimitConfig | undefined,
	vitalsPath: string | undefined,
	vitalsSummaryPath: string | undefined
) => {
	const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
	const rules: ResolvedRule[] = (config?.rules ?? []).map((rule) => ({
		limit: rule.limit,
		path: rule.path,
		windowMs: rule.windowMs ?? windowMs
	}));
	/* Only when the app has not said something about that path itself.
	 *
	 * The batch endpoint first, so an explicit rule for either path is
	 * still what matches: `ruleFor` is consulted against the rules as they
	 * stand, and a default pushed for one path must not look like the app's
	 * own opinion about the other. */
	if (vitalsPath !== undefined && ruleFor(rules, vitalsPath) === undefined)
		rules.push({
			limit: VITALS_DEFAULT_LIMIT,
			path: vitalsPath,
			windowMs: DEFAULT_WINDOW_MS
		});
	if (
		vitalsSummaryPath !== undefined &&
		rules.every((rule) => rule.path !== vitalsSummaryPath)
	)
		rules.push({
			limit: VITALS_SUMMARY_DEFAULT_LIMIT,
			path: vitalsSummaryPath,
			windowMs: DEFAULT_WINDOW_MS
		});

	return rules;
};

/** The headers a client needs to behave: the IETF `RateLimit-*` draft
 *  names, plus `Retry-After` on a refusal, which is the one every HTTP
 *  client already understands. */
export const rateLimitHeaders = (decision: RateLimitDecision) => {
	const headers: Record<string, string> = {
		'RateLimit-Limit': String(decision.limit),
		'RateLimit-Remaining': String(decision.remaining),
		'RateLimit-Reset': String(decision.resetSeconds)
	};
	if (!decision.allowed)
		headers['Retry-After'] = String(decision.resetSeconds);

	return headers;
};

export type RateLimitPluginOptions = {
	config: RateLimitConfig | undefined;
	/** Paths a global `limit` must not cover — the health endpoints, whose
	 *  refusal an orchestrator reads as the process being unfit. */
	exemptPaths?: readonly string[];
	/** The vitals endpoint path, when this app serves one, so it can be
	 *  limited by default. */
	vitalsPath?: string;
	/** The vitals summary path, when one is served, so it gets a rule of
	 *  its own instead of inheriting the batch endpoint's. */
	vitalsSummaryPath?: string;
};

/** Nothing, when no path would be limited. */
export const rateLimit = ({
	config,
	exemptPaths = [],
	vitalsPath,
	vitalsSummaryPath
}: RateLimitPluginOptions) => {
	const rules = resolveRules(config, vitalsPath, vitalsSummaryPath);
	const fallbackLimit = config?.limit;
	if (rules.length === 0 && fallbackLimit === undefined)
		return new Elysia({ name: 'absolutejs-rate-limit-disabled' });

	const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
	const maxKeys = config?.maxKeys;
	/* Its own setting when it has one, the deployment's otherwise: a
	 * server that says it is behind a proxy should not have to say so
	 * twice, and `trustProxy: false` here still opts this out. */
	const trustProxy = config?.trustProxy ?? isProxyTrusted();
	/* One limiter per distinct (limit, window), so rules do not share a
	 * bucket and a per-path limit means what it says. */
	const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();
	const limiterFor = (limit: number, forWindowMs: number) => {
		const key = `${limit}:${forWindowMs}`;
		const existing = limiters.get(key);
		if (existing !== undefined) return existing;
		const limiter = createRateLimiter({
			limit,
			maxKeys,
			windowMs: forWindowMs
		});
		limiters.set(key, limiter);

		return limiter;
	};

	return new Elysia({ name: 'absolutejs-rate-limit' })
		.onRequest(({ request, server, set }) => {
			const path = new URL(request.url).pathname;
			const rule = ruleFor(rules, path);
			const limit =
				rule?.limit ??
				(exemptPaths.includes(path) ? undefined : fallbackLimit);
			if (limit === undefined) return undefined;

			const address = server?.requestIP(request)?.address;
			const key = clientKeyFor(request, address, trustProxy);
			const decision = limiterFor(
				limit,
				rule?.windowMs ?? windowMs
			).check(`${rule?.path ?? '*'}|${key}`);

			Object.assign(set.headers, rateLimitHeaders(decision));
			if (decision.allowed) return undefined;

			/* Returned from `onRequest`, so a refused request never reaches
			 * a handler — the point being to not do the work. */
			return new Response('Too Many Requests', {
				headers: {
					...rateLimitHeaders(decision),
					'content-type': 'text/plain; charset=utf-8'
				},
				status: TOO_MANY_REQUESTS
			});
		})
		.as('global');
};
