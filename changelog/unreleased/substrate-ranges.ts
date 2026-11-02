import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The framework pinned packages apps install themselves to exact versions: typebox 1.3.16, exact-mirror 1.2.6, @elysia/static, @elysia/openapi and @elysia/server-timing 2.0.0-rc.0, and @absolutejs/pwa 0.16.3. An app on any other version got a second copy nested under the framework, and for typebox that is a correctness hazard, not bloat: Elysia validates with the app's typebox, and a schema built by a different copy is foreign to it. renown could not move to typebox 1.4 for this reason (2026-11-01). They are now ranges within the same major (pwa within 0.16 and 0.17, whose 0.17.0 only adds asset-failure recovery), and the framework's own tests run on the newest of each: typebox 1.4.3, Elysia 2.0.0-rc.1, pwa 0.17.0.",
	kind: 'fixed',
	summary:
		'Apps share one copy of typebox, exact-mirror, the Elysia plugins and pwa with the framework',
	symbols: ['prepare']
};
