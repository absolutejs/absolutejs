import type {
	DateInput,
	I18nPayload,
	MessageCatalog,
	MessageTree,
	Translate,
	Translator
} from '../../types/i18n';
import { formatMessage } from './formatMessage';
import {
	getDateTimeFormat,
	getListFormat,
	getNumberFormat,
	getRelativeTimeFormat
} from './intlCache';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** The message at a dot-separated key, or undefined. */
export const lookupMessage = (messages: MessageTree, key: string) => {
	let node: string | MessageTree | undefined = messages;
	for (const segment of key.split('.')) {
		if (typeof node !== 'object') return undefined;
		node = node[segment];
	}

	return typeof node === 'string' ? node : undefined;
};

const isMessageTreeValue = (value: unknown): value is string | MessageTree =>
	typeof value === 'string' || isMessageTree(value);

/** Whether `value` is an i18n payload (as passed through page props). */
export const isI18nPayload = (value: unknown): value is I18nPayload =>
	isRecord(value) &&
	typeof value.locale === 'string' &&
	typeof value.defaultLocale === 'string' &&
	(value.dir === 'ltr' || value.dir === 'rtl') &&
	isMessageTree(value.messages);
/** Whether `value` is a catalog: nested plain objects of strings. */
export const isMessageTree = (value: unknown): value is MessageTree =>
	isRecord(value) && Object.values(value).every(isMessageTreeValue);

const toDate = (value: DateInput) =>
	value instanceof Date ? value : new Date(value);

const warnedKeys = new Set<string>();

const warnMissing = (locale: string, key: string) => {
	const id = `${locale}:${key}`;
	if (warnedKeys.has(id)) return;
	warnedKeys.add(id);
	console.warn(`[i18n] Missing message "${key}" for locale "${locale}"`);
};

/** A translator over a payload's messages. Pass your default catalog's
 *  type (`createTranslator<typeof en>(payload)`) to type-check keys and
 *  ICU parameters. */
export const createTranslator = <Catalog = MessageCatalog>(
	payload: I18nPayload
) => {
	const { locale, messages } = payload;
	const t: Translate<Catalog> = (key, ...args: unknown[]) => {
		const message = lookupMessage(messages, key);
		if (message === undefined) {
			warnMissing(locale, key);

			return key;
		}
		const [params] = args;

		return formatMessage(locale, message, isRecord(params) ? params : {});
	};
	const translator: Translator<Catalog> = {
		dir: payload.dir,
		locale,
		t,
		formatDate: (value, options) =>
			getDateTimeFormat(locale, options).format(toDate(value)),
		formatList: (items, options) =>
			getListFormat(locale, options).format(items),
		formatNumber: (value, options) =>
			getNumberFormat(locale, options).format(value),
		formatRelativeTime: (value, unit, options) =>
			getRelativeTimeFormat(locale, options).format(value, unit),
		has: (key) => lookupMessage(messages, key) !== undefined
	};

	return translator;
};
