import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The absolute_action cookie, which carries a no-JavaScript submission's result to the page it redirects to, was unsigned base64 JSON. Anyone able to set a cookie for the site — an untrusted subdomain, an active attacker on a connection without HSTS, a malicious extension — could forge one and make the next page render a result of their choosing; the rewriter escapes what it writes, so the exposure was a spoofed message rather than script. The cookie is now signed with ABSOLUTE_SECRET under its own purpose, and one without a valid signature is ignored. Signing is active except in production with no secret configured, where a generated key would be lost on restart and differ between instances, leaving a visitor with a successful submission and no result at all; there the cookie stays unsigned, is still accepted, and the server warns once naming the variable. That is not a downgrade, because whenever a secret is available a missing signature is rejected rather than merely preferred. Existing apps keep working on upgrade; setting ABSOLUTE_SECRET is what turns the protection on.",
	kind: 'security',
	summary: 'The no-JavaScript form result cookie is signed',
	symbols: ['getActionState']
};
