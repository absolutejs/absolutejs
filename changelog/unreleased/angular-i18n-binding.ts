import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Angular pages reach a locale's messages through DI: `provideAbsoluteI18n(i18n.payload(['home']))` in the route's providers, `injectI18n<typeof en>()` in a component or service, and a pure `t` pipe in templates (`{{ 'home.title' | t: { name } }}`). `LOCALE_ID` comes from the same payload, so Angular's own date, number and currency pipes format in the locale the messages are in. Angular has no page-props channel and handler providers are SSR-only, so the payload travels to the browser through TransferState, which provideClientHydration already serializes: add `provideAbsoluteI18n()` with no argument to angular.providers and the client hydrates from what the route transferred. Hydrating with nothing transferred throws and names the call to add, rather than rendering the message keys to visitors. Angular's document shell also now writes `lang` and `dir` from the request locale, which it never did — the same defect Vue had before beta.222.",
	kind: 'added',
	summary:
		'Angular pages get i18n bindings, a t pipe, and a localized document shell',
	symbols: ['provideAbsoluteI18n', 'injectI18n', 'TPipe']
};
