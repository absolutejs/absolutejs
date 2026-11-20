import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'form: { body, csrf: { token: true } } adds a signed double-submit token to the cross-origin check that is already on by default. The absolute_csrf cookie holds a random value and the hidden _csrf field, or the x-absolute-csrf header, holds an HMAC of it, so a cross-site page cannot produce a matching pair even though the browser attaches the cookie for it. getCsrfToken() mints the token while rendering the way getCspNonce() does, the runtime sets the cookie and marks the page private, no-store, and the token is stripped from the body before validation. Signing uses ABSOLUTE_SECRET, which production requires rather than generating a per-process key that would stop working after a restart or on a second instance. Turn it on where Sec-Fetch-Site and Origin cannot be trusted: behind a proxy that strips them, or alongside an untrusted subdomain.',
	kind: 'added',
	summary: 'Opt-in signed CSRF tokens for form actions',
	symbols: ['ActionCsrfOptions', 'getCsrfToken']
};
