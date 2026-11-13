import { getContext, hasContext, setContext } from 'svelte';
import type { I18nPayload, MessageCatalog } from '../../types/i18n';
import { createTranslator, isI18nPayload } from '../i18n/translator';

const I18N_CONTEXT = Symbol.for('absolutejs.i18n');

/** The translator `setI18n()` shared from an ancestor component. */
export const getI18n = <Catalog = MessageCatalog>() => {
	const payload: unknown = hasContext(I18N_CONTEXT)
		? getContext(I18N_CONTEXT)
		: undefined;
	if (!isI18nPayload(payload)) {
		throw new Error(
			'getI18n() found no messages: call setI18n(payload) in the page component first'
		);
	}

	return createTranslator<Catalog>(payload);
};
/** Call in the page component with the payload prop from the server:
 *  shares the locale's messages with every component below (`getI18n()`)
 *  and returns this page's translator. Pass your default catalog's type
 *  to type-check keys and ICU parameters. */
export const setI18n = <Catalog = MessageCatalog>(payload: I18nPayload) => {
	setContext(I18N_CONTEXT, payload);

	return createTranslator<Catalog>(payload);
};
