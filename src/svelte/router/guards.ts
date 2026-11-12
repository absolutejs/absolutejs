import type {
	NavigationContext,
	NavigationRedirectTarget,
	RouteGuard
} from '../../../types/svelteRouter';

/* Guard evaluation shared by the browser navigation path and the server
 * render: run a chain of guards in order and reduce their answers to one
 * decision. Pure apart from awaiting the guards themselves. */

export type GuardEntry = {
	guard: RouteGuard;
	params: Record<string, string | undefined>;
};

export type GuardDecision =
	| { kind: 'allow' }
	| { kind: 'cancel' }
	| { kind: 'redirect'; location: string; replace: boolean }
	| { kind: 'stale' };

export type GuardRunContext = Omit<NavigationContext, 'params'>;

const ALLOW: GuardDecision = { kind: 'allow' };
const CANCEL: GuardDecision = { kind: 'cancel' };
const STALE: GuardDecision = { kind: 'stale' };

/** Thrown (or returned) by `redirect()`. An `Error` so a throw from deep
 *  inside a helper keeps a useful stack; recognised structurally, so a
 *  copy of the router bundled twice still understands it. */
export class NavigationRedirect
	extends Error
	implements NavigationRedirectTarget
{
	redirect: string;
	replace: boolean;

	constructor(location: string, replace: boolean) {
		super(`Redirect to ${location}`);
		this.name = 'NavigationRedirect';
		this.redirect = location;
		this.replace = replace;
	}
}

const isRedirectTarget = (value: unknown): value is NavigationRedirectTarget =>
	typeof value === 'object' &&
	value !== null &&
	'redirect' in value &&
	typeof value.redirect === 'string';

const toDecision = (result: unknown): GuardDecision => {
	if (result === false) return CANCEL;
	if (typeof result === 'string') {
		return { kind: 'redirect', location: result, replace: false };
	}
	if (!isRedirectTarget(result)) return ALLOW;
	const replace = 'replace' in result && result.replace === true;

	return { kind: 'redirect', location: result.redirect, replace };
};

const evaluateGuard = async (entry: GuardEntry, context: GuardRunContext) => {
	try {
		return toDecision(
			await entry.guard({ ...context, params: entry.params })
		);
	} catch (error) {
		if (isRedirectTarget(error)) return toDecision(error);
		throw error;
	}
};

const runFrom = async (
	entries: GuardEntry[],
	index: number,
	context: GuardRunContext,
	isStale: () => boolean
): Promise<GuardDecision> => {
	const entry = entries[index];
	if (!entry) return ALLOW;
	const decision = await evaluateGuard(entry, context);
	if (isStale()) return STALE;
	if (decision.kind !== 'allow') return decision;

	return runFrom(entries, index + 1, context, isStale);
};

/**
 * Redirect from inside a guard. Return it, or throw it from a helper the
 * guard calls — both short-circuit the guard chain the same way:
 *
 *   guard={({ request }) => {
 *     if (!isSignedIn(request)) throw redirect('/login');
 *   }}
 *
 * In the browser the redirect adds a history entry unless
 * `{ replace: true }`; on the server it is a 302.
 */
export const redirect = (
	location: string,
	options: { replace?: boolean } = {}
) => new NavigationRedirect(location, options.replace === true);

/** Run `entries` one after another; the first guard that cancels or
 *  redirects decides. `isStale` is checked after every guard so a newer
 *  navigation can abandon this one mid-chain. */
export const runGuardChain = (
	entries: GuardEntry[],
	context: GuardRunContext,
	isStale: () => boolean = () => false
) => runFrom(entries, 0, context, isStale);
