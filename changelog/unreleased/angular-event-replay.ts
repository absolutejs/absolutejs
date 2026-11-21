import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A click made before an Angular page finishes hydrating now arrives once it has. Angular pages shipped baseline hydration only — `provideClientHydration()` with no features gives DOM reuse and the HTTP transfer cache and nothing else — so every tap in the window between the server's HTML and the client's bootstrap was dropped, silently, and worst on the slow devices where that window is widest. Angular's own SSR scaffold enables `withEventReplay()`, so this was behind the framework's own default. Three pieces were missing, not one: the feature on the server, where it stamps the `jsaction` attributes replay reads; the feature on the client, in the page index the build generates; and the `ng-event-dispatch-contract` script in the document shell, which Angular looks up by id while rendering and which the Angular CLI injects into its own index.html — without it Angular removes the replay machinery and the feature does nothing at all. The contract script is inlined into the shell with the page's CSP nonce, since it has to run before anything else to catch the first tap. An Angular install that does not ship the script warns once and renders without replay.",
	kind: 'added',
	summary: 'Angular pages replay clicks made before they hydrate'
};
