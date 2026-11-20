import { inject, provide, type InjectionKey } from 'vue';
import type { I18nPayload, MessageCatalog } from '../../types/i18n';
import { createTranslator, isI18nPayload } from '../i18n/translator';

/* Vue's half of i18n, the same shape React and Svelte already have: the
 * page receives the locale's messages as an ordinary prop from the server
 * (`i18n.payload(['home'])`), hands them to `provideI18n`, and every
 * component below reaches the translator with `useI18n`. The payload
 * rides `window.__INITIAL_PROPS__`, so the browser hydrates against the
 * messages the server rendered — no second fetch and no new inline
 * script. */

const I18N_KEY: InjectionKey<I18nPayload> = Symbol.for('absolutejs.i18n');

/** Call in the page's `setup` with the payload prop from the server:
 *  shares the locale's messages with every component below (`useI18n()`)
 *  and returns this page's translator. Pass your default catalog's type
 *  to type-check keys and ICU parameters:
 *  `const { t } = provideI18n<typeof en>(props.i18n)`. */
export const provideI18n = <Catalog = MessageCatalog>(payload: I18nPayload) => {
	provide(I18N_KEY, payload);

	return createTranslator<Catalog>(payload);
};

/** The translator `provideI18n()` shared from an ancestor component.
 *
 *  Throws when nothing provided one, rather than translating into the
 *  keys themselves: a page that forgot the call would otherwise render
 *  `home.title` to visitors and look like a missing message. */
export const useI18n = <Catalog = MessageCatalog>() => {
	const payload: unknown = inject(I18N_KEY, undefined);
	if (!isI18nPayload(payload)) {
		throw new Error(
			'useI18n() found no messages: call provideI18n(payload) in the page component first'
		);
	}

	return createTranslator<Catalog>(payload);
};
