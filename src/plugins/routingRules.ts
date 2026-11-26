/* The config's redirects, rewrites and headers, applied to requests.
 *
 * All three run in `onRequest`, before any route is looked up, which is
 * what lets a rule answer for a path no route serves (the usual reason a
 * redirect exists).
 *
 * A REWRITE is served by sending the request through the server again at
 * its new address. It is the only way that is right in general: the
 * destination may be a page, an API route, a static file or a file
 * route, each with its own hooks, and they all sit behind the same
 * `fetch`. The re-entered request is remembered by identity so it is not
 * rewritten or redirected a second time — a rewrite to `/b` followed by a
 * redirect from `/b` would otherwise leak the address the rewrite was
 * hiding.
 *
 * HEADERS are matched against the path the visitor asked for, and set
 * before the route runs. A route that sets the same header itself, or
 * returns a `Response` carrying it, keeps its own value: a rule is a
 * default for the paths it names, not an override.
 *
 * With one exception, and it is the commonest reason to write a header
 * rule at all. The files the framework serves from the build directory
 * get a `cache-control` from the static file server, set the same way a
 * route would set it — so under the rule above, a rule for `/assets/*`
 * could never change how assets are cached. That header is the file
 * server's default (and the asset-cache policy's), not a decision
 * anybody made about this app, so for a file the framework serves the
 * rule wins. `isFrameworkFile` is how
 * `prepare()` tells the two apart; without it nothing is overridden. */

import { Elysia } from 'elysia';
import {
	compileRoutingRules,
	decideRouting,
	hasRoutingRules,
	headersFor
} from '../core/routingRules';
import type { RoutingRulesConfig } from '../../types/routingRules';

type Dispatch = (request: Request) => Promise<Response> | Response;

export type RoutingRulesOptions = {
	/** Serves a rewritten request. Defaults to the running server's
	 *  `fetch`; a test with no server passes its app's `handle`. */
	dispatch?: Dispatch;
	/** Whether a request path is a file the framework's own static
	 *  server answers. Header rules override that server's defaults. */
	isFrameworkFile?: (pathname: string) => boolean;
};

const NOT_FOUND = 404;

export const routingRules = (
	config: RoutingRulesConfig,
	options: RoutingRulesOptions = {}
) => {
	if (!hasRoutingRules(config))
		return new Elysia({ name: 'absolutejs-routing-rules-none' });

	const rules = compileRoutingRules(config);
	/* A rewritten request, and the path the visitor asked for: header
	 * rules are matched against that one, not the address it is served
	 * from. */
	const reentered = new WeakMap<Request, string>();
	const isFrameworkFile = options.isFrameworkFile ?? (() => false);

	return (
		new Elysia({ name: 'absolutejs-routing-rules', seed: config })
			.onRequest(({ request, server, set }) => {
				if (reentered.has(request)) return undefined;
				const url = new URL(request.url);
				Object.assign(set.headers, headersFor(rules, url.pathname));

				const decision = decideRouting(rules, url.pathname, url.search);
				if (decision.kind === 'none') return undefined;
				if (decision.kind === 'redirect')
					return new Response(null, {
						headers: { location: decision.location },
						status: decision.status
					});

				url.pathname = decision.pathname;
				url.search = decision.search;
				const rewritten = new Request(url, request);
				reentered.set(rewritten, new URL(request.url).pathname);
				const dispatch =
					options.dispatch ??
					(server
						? (next: Request) => server.fetch(next)
						: undefined);

				// Nothing to send it through: an app handled without a server
				// and without `dispatch`. Refuse rather than serve the wrong URL.
				return dispatch
					? dispatch(rewritten)
					: new Response('Not Found', { status: NOT_FOUND });
			})
			/* `mapResponse`, because it is the one hook that sees every way a
			 * file leaves the framework: the static plugin's handler, the
			 * asset-cache policy applied after it, and a precompressed copy
			 * answered early from another plugin's `onRequest`. */
			.mapResponse(({ request, responseValue, set }) => {
				const served = new URL(request.url).pathname;
				if (!isFrameworkFile(served)) return;
				const headers = headersFor(
					rules,
					reentered.get(request) ?? served
				);
				if (!(responseValue instanceof Response)) {
					Object.assign(set.headers, headers);

					return;
				}
				Object.entries(headers).forEach(([name, value]) => {
					responseValue.headers.set(name, value);
				});
			})
			.as('global')
	);
};
