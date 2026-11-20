import {
	ENVIRONMENT_INITIALIZER,
	inject,
	InjectionToken,
	LOCALE_ID,
	makeStateKey,
	TransferState,
	type EnvironmentProviders,
	type Provider
} from '@angular/core';
import type { I18nPayload, MessageCatalog } from '../../types/i18n';
import { createTranslator, isI18nPayload } from '../i18n/translator';
import { ABSOLUTE_I18N } from './components/i18n.token';

/* Angular's half of i18n.
 *
 * The other frameworks hand the payload to the page as a prop, which
 * rides `window.__INITIAL_PROPS__` to the browser. Angular has no props
 * channel — its model is dependency injection — so the payload travels
 * the way Angular moves server state: `TransferState`, which
 * `provideClientHydration` already serializes into the page (the server
 * renderer has had it since Angular hydration was wired here).
 *
 * So there are two call sites, and one function serves both:
 *
 *   // the route, per request: the messages this page needs
 *   providers: [provideAbsoluteI18n(i18n.payload(['home']))]
 *
 *   // absolute.config.ts > angular.providers, once, both sides
 *   providers: [provideAbsoluteI18n()]
 *
 * With a payload it provides that payload and writes it into
 * `TransferState`. Without one it reads `TransferState`, which is what
 * the browser does after hydration. Handler providers are merged on top
 * of the bundled ones, so on the server the per-request call wins. */

const I18N_STATE_KEY = makeStateKey<I18nPayload>('absolutejs.i18n');

/** The request's messages, for `injectI18n()`. Separate from the pipe's
 *  narrow token so the typed translator can be built per caller, with
 *  that caller's catalog type. */
export const ABSOLUTE_I18N_PAYLOAD = new InjectionToken<I18nPayload>(
	'absolutejs.i18n.payload'
);

const readPayload = (payload: I18nPayload | undefined) => {
	if (payload) return payload;
	const transferred: unknown = inject(TransferState).get(
		I18N_STATE_KEY,
		null
	);
	if (isI18nPayload(transferred)) return transferred;

	throw new Error(
		'provideAbsoluteI18n() found no messages to hydrate: the route that rendered this page must call provideAbsoluteI18n(i18n.payload(…)) in its own providers'
	);
};

/** The translator for the current request. Pass your default catalog's
 *  type to type-check keys and ICU parameters:
 *  `const { t, locale, dir } = injectI18n<typeof en>()`. */
export const injectI18n = <Catalog = MessageCatalog>() =>
	createTranslator<Catalog>(inject(ABSOLUTE_I18N_PAYLOAD));

/** The locale's messages for an Angular page: `injectI18n()` in a
 *  component or service, the `t` pipe in a template, and `LOCALE_ID` so
 *  Angular's own `date`, `number` and `currency` pipes format in the same
 *  locale.
 *
 *  Pass the payload in the route's providers; call it without one in the
 *  app's bundled providers so the browser hydrates from the same
 *  messages. */
export const provideAbsoluteI18n = (payload?: I18nPayload) => {
	const providers: (Provider | EnvironmentProviders)[] = [
		{
			provide: ABSOLUTE_I18N_PAYLOAD,
			useFactory: () => readPayload(payload)
		},
		{
			provide: ABSOLUTE_I18N,
			useFactory: () => createTranslator(inject(ABSOLUTE_I18N_PAYLOAD))
		},
		{
			provide: LOCALE_ID,
			useFactory: () => inject(ABSOLUTE_I18N_PAYLOAD).locale
		}
	];
	if (!payload) return providers;

	// Eager, so the payload reaches TransferState even on a page that
	// never injects the token itself: a factory alone runs on first use,
	// and the browser would then hydrate with nothing.
	return [
		...providers,
		{
			multi: true,
			provide: ENVIRONMENT_INITIALIZER,
			useValue: () => {
				inject(TransferState).set(I18N_STATE_KEY, payload);
			}
		}
	];
};
