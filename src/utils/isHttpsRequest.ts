/* Whether the browser reached us over TLS.
 *
 * Not the same question as whether THIS process is serving TLS. A proxy
 * that terminates TLS forwards plain HTTP, so `request.url` says `http:`
 * on most real deployments — which is the shape section 5 of the plan is
 * about, and the shape every managed platform uses.
 *
 * `secureHeaders()` already knew this and consulted
 * `x-forwarded-proto`. The cookie code did not, and the two disagreed
 * exactly where it matters:
 *
 *   shape                   cookie code   secureHeaders
 *   direct https            true          true
 *   direct http             false         false
 *   TLS-terminating proxy   false         TRUE
 *   CDN then load balancer  false         TRUE
 *   proxy over plain http   false         false
 *
 * So behind a proxy the CSRF token cookie and the form-action flash
 * cookie were issued without `Secure`, and a browser will then send them
 * over plain HTTP to the same host — where anyone on the network can
 * read them. A readable CSRF token defeats the token half of the CSRF
 * check it exists for.
 *
 * On trusting a client-supplied header: this can only ever turn `Secure`
 * ON, because it is OR-ed with the connection's real protocol. A client
 * that lies about `x-forwarded-proto` marks its OWN cookies `Secure`,
 * which leaks nothing — at worst its browser declines to send them over
 * http. There is no direction in which spoofing this weakens anybody, so
 * it needs no trust-boundary configuration to be safe. */

/** The first value of a comma-separated forwarded header: the client's
 *  own hop. Later values are the proxies in between, so a CDN in front of
 *  a load balancer sends `https, http` and the client's protocol is the
 *  first one. */
const clientHop = (value: string | null) =>
	(value?.split(',')[0] ?? '').trim().toLowerCase();

/** True when the original request was over TLS, whether this process
 *  terminated it or a proxy did. */
export const isHttpsRequest = (request: Request) => {
	if (new URL(request.url).protocol === 'https:') return true;
	if (clientHop(request.headers.get('x-forwarded-proto')) === 'https')
		return true;

	/* `Forwarded: proto=https;for=…` is the standardised form (RFC 7239)
	 * that some proxies send instead of the `x-forwarded-*` family. */
	const forwarded = clientHop(request.headers.get('forwarded'));

	return /(?:^|;)\s*proto\s*=\s*"?https"?\s*(?:;|$)/u.test(forwarded);
};
