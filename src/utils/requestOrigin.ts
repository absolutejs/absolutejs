import { isHttpsRequest } from './isHttpsRequest';

/* The host and origin the BROWSER used, which behind a proxy is not what
 * this process was reached on.
 *
 * The scheme was already handled (`isHttpsRequest`). The host was not:
 * every reader took the `Host` header as it arrived, and a proxy that
 * forwards to an upstream by name sends that name — `app:3000` — and
 * puts the real one in `x-forwarded-host`. Behind one, i18n's domain
 * strategy matched no domain, the CSRF fallback compared the browser's
 * Origin against an internal name and refused, and hreflang links
 * pointed at a host nobody can reach.
 *
 * Unlike the scheme, the forwarded host is NOT safe to believe from
 * anyone. `x-forwarded-proto` can only switch `Secure` on, for the
 * sender's own cookies. A forwarded host goes into absolute URLs in the
 * page, so a client that may choose it chooses where those links point,
 * and a cache in between can hand that page to someone else. So it is
 * read only when the deployment says a proxy it controls sets it:
 * `trustProxy: true`, or ABSOLUTE_TRUST_PROXY=1. */

type Environment = Record<string, string | undefined>;

/* A host and optional port, and nothing a URL could be built wrong from:
 * no scheme, path, credentials or whitespace. A forwarded value that is
 * not this is ignored, not repaired. */
const HOST_PATTERN =
	/^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/iu;

/** The first value of a comma-separated forwarded header: the client's
 *  own hop, as in `isHttpsRequest`. */
const clientHop = (value: string | null) => (value?.split(',')[0] ?? '').trim();

const validHost = (value: string) =>
	HOST_PATTERN.test(value) ? value : undefined;

const forwardedHost = (request: Request) => {
	const direct = clientHop(request.headers.get('x-forwarded-host'));
	if (direct) return validHost(direct);

	/* `Forwarded: for=…;host=example.com;proto=https` (RFC 7239), which
	 * some proxies send instead of the `x-forwarded-*` family. */
	const standard = clientHop(request.headers.get('forwarded'));
	const match = /(?:^|;)\s*host\s*=\s*"?([^";]+)"?\s*(?:;|$)/iu.exec(
		standard
	);

	return match?.[1] === undefined ? undefined : validHost(match[1].trim());
};

/** Whether this deployment says it sits behind a proxy it controls. Set
 *  from the `trustProxy` config by `prepare()`, or directly. */
export const isProxyTrusted = (env: Environment = process.env) =>
	env.ABSOLUTE_TRUST_PROXY === '1' || env.ABSOLUTE_TRUST_PROXY === 'true';

/** The host the browser asked for, port included when it sent one. */
export const requestHost = (request: Request, trusted = isProxyTrusted()) =>
	(trusted ? forwardedHost(request) : undefined) ??
	request.headers.get('host') ??
	new URL(request.url).host;

/** The origin the browser used: what an absolute link back to this app
 *  should start with. */
export const requestOrigin = (request: Request, trusted = isProxyTrusted()) =>
	`${isHttpsRequest(request) ? 'https' : 'http'}://${requestHost(request, trusted)}`;
