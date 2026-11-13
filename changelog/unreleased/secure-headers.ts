import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`secureHeaders()` is an opt-in Elysia plugin that sends a Content-Security-Policy with a per-request nonce (`'strict-dynamic'`, no `'unsafe-inline'` for scripts), plus `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors` and `Permissions-Policy`, each overridable. Every inline `<script>` and `<style>` AbsoluteJS writes carries the nonce: page bootstraps and initial props for every framework, island state, streaming-slot patches, inline page CSS, Svelte and Angular component styles, speculation rules, the error pages and the dev HMR client. The nonce is added where each script is written, so a script injected through `{@html}` / `v-html` / `dangerouslySetInnerHTML` stays blocked. Pre-rendered and ISR pages store the nonce they were rendered with and swap it for each request's, on scripts, styles and `<link rel=\"modulepreload\">`. A page pre-rendered without the plugin is served without a policy and logged. In development the policy also allows the HMR WebSocket and `'unsafe-eval'` (Angular's dev compiler). `getCspNonce()` and the `cspNonce` context value give your own inline scripts the nonce. See docs/SECURITY_HEADERS.md.",
	kind: 'added',
	summary:
		'`secureHeaders()`: a strict nonce-based Content-Security-Policy and security headers for every framework',
	symbols: ['secureHeaders', 'getCspNonce']
};
