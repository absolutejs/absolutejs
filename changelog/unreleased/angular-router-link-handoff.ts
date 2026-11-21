import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "On an Angular page that exports `routes`, a `routerLink` pointing at a URL the route table does not match did nothing at all: Angular's router failed the navigation with NG04002, the address bar never changed, and the only trace was a console error that a production build strips to the offending segment. That is the right answer for an Angular application on its own, where a URL outside the route table is a mistake — but in an app whose next page is React or Svelte it usually is not, and `routerLink` is how every other link on the page is written. The build now wires an Angular navigation-error handler into the `provideRouter(...)` it injects for such a page, and a no-match hands the URL to cross-framework document navigation: a soft swap when the layer is installed and the page can be torn down, a normal page load otherwise. Only NG04002 is touched — a failed guard, a resolver that threw and a lazy chunk that would not load are reported by Angular exactly as before, and a page whose own URL is the unmatched one is never handed off, since that would ask the layer to navigate where it already is. The URL handed off is the one the router would have shown, so it carries `APP_BASE_HREF`: `routerLink=\"/pricing\"` on a page mounted at `/portal/*` means `/portal/pricing`. To leave the mount entirely, `absLink` (or a plain `href`) is still the way. `absoluteRouterHandoff` is exported from `@absolutejs/absolute/angular/components` for an app that writes its own `provideRouter` call.",
	kind: 'fixed',
	summary:
		'An Angular routerLink to another framework’s page navigates instead of dying',
	symbols: ['absoluteRouterHandoff', 'resolveRouterHandoff']
};
