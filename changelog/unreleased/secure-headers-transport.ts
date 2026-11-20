import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`secureHeaders()` now sends Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy, and can send Strict-Transport-Security. COOP defaults to `same-origin-allow-popups` rather than `same-origin`, because full isolation severs window.opener and breaks an OAuth popup mid-flow; CORP defaults to `same-site` rather than `same-origin`, because serving your own assets from a CDN subdomain is the common case. Both take an explicit value or `false`. HSTS is off unless asked for: it is the one header here that cannot be walked back, since a browser that has it treats the host as HTTPS-only until the max-age expires and `includeSubDomains` or `preload` outlive any later change — an HTTP-only staging subdomain becomes unreachable for anyone who saw it once. `hsts: true` sends max-age=15552000 with neither flag, an object sets them explicitly, and it is only sent to a request that arrived over HTTPS, directly or through a proxy whose X-Forwarded-Proto says so. The plugin stays opt-in, because a CSP arriving on an upgrade would break any app with an inline script or a widget that is not nonce-aware; instead `absolute doctor` now reports when an app's server entry does not mount it, which nothing else would have said.",
	kind: 'added',
	summary: 'secureHeaders() sends COOP and CORP, and HSTS on request',
	symbols: ['secureHeaders', 'securityHeadersFor', 'SecureHeadersOptions']
};
