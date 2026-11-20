/* Dependency-free access to the current request's locale, for render code
 * that can't import the i18n plugin (the Svelte document shell writes
 * `<html lang dir>` from it). `i18nPlugin()` registers the getter; without
 * it these return undefined and the shell keeps `lang="en"`. Keyed by
 * `Symbol.for` so separate module copies share one getter. */

import type { MessageValue, TextDirection } from '../../types/i18n';

export type RequestLocale = { locale: string; dir: TextDirection };

const GETTER_KEY = Symbol.for('absolutejs.requestLocaleGetter');
const TRANSLATOR_GETTER_KEY = Symbol.for('absolutejs.requestTranslatorGetter');

/** What message substitution needs from the request's translator. The
 *  plugin registers the full one; this is the part a renderer uses, and
 *  keeping it narrow is what lets this module stay free of the catalog
 *  types. */
export type RequestTranslate = (
	key: string,
	params?: Record<string, MessageValue>
) => string;

const isRequestLocale = (value: unknown): value is RequestLocale =>
	typeof value === 'object' &&
	value !== null &&
	'locale' in value &&
	typeof value.locale === 'string' &&
	'dir' in value &&
	(value.dir === 'ltr' || value.dir === 'rtl');

const escapeAttribute = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const htmlLangAttributes = (fallback = 'en') => {
	const current = readRequestLocale();
	if (!current) return ` lang="${escapeAttribute(fallback)}"`;

	return ` lang="${escapeAttribute(current.locale)}" dir="${current.dir}"`;
};

export const readRequestLocale = () => {
	const getter: unknown = Reflect.get(globalThis, GETTER_KEY);
	if (typeof getter !== 'function') return undefined;
	const value: unknown = getter();

	return isRequestLocale(value) ? value : undefined;
};

export const readRequestTranslate = () => {
	const getter: unknown = Reflect.get(globalThis, TRANSLATOR_GETTER_KEY);
	if (typeof getter !== 'function') return undefined;
	const translate: unknown = getter();
	if (typeof translate !== 'function') return undefined;
	// Wrapped rather than returned: the value crossed a `globalThis`
	// boundary, so its signature is a claim until it is called. A
	// non-string answer falls back to the key, which is what a missing
	// message already renders as.
	const typed: RequestTranslate = (key, params) => {
		const result: unknown = Reflect.apply(translate, undefined, [
			key,
			params
		]);

		return typeof result === 'string' ? result : key;
	};

	return typed;
};

export const registerRequestLocaleGetter = (
	getter: () => RequestLocale | undefined
) => {
	Reflect.set(globalThis, GETTER_KEY, getter);
};

export const registerRequestTranslateGetter = (
	getter: () => RequestTranslate | undefined
) => {
	Reflect.set(globalThis, TRANSLATOR_GETTER_KEY, getter);
};
