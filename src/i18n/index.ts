/* `@absolutejs/absolute/i18n`: the browser-safe half of i18n — the ICU
 * formatter, translators over a hydrated payload, Intl helpers and the
 * locale routing helpers. The server plugin (`defineI18n`, `i18nPlugin`)
 * is exported from `@absolutejs/absolute`. */

export { defineMessages } from './defineMessages';
export { formatMessage, parseMessage } from './formatMessage';
export type { MessageNode } from './formatMessage';
export {
	alternateLinks,
	localeDirection,
	localeFromPath,
	localizePath,
	matchLocale,
	negotiateLocale,
	parseAcceptLanguage,
	readCookie,
	stripLocalePrefix
} from './routing';
export {
	createTranslator,
	isI18nPayload,
	isMessageTree,
	lookupMessage
} from './translator';
export type * from '../../types/i18n';
