/* Dependency-free access to the current request's locale, for render code
 * that can't import the i18n plugin (the Svelte document shell writes
 * `<html lang dir>` from it). `i18nPlugin()` registers the getter; without
 * it these return undefined and the shell keeps `lang="en"`. Keyed by
 * `Symbol.for` so separate module copies share one getter. */

import type { TextDirection } from '../../types/i18n';

export type RequestLocale = { locale: string; dir: TextDirection };

const GETTER_KEY = Symbol.for('absolutejs.requestLocaleGetter');

const isRequestLocale = (value: unknown): value is RequestLocale =>
	typeof value === 'object' &&
	value !== null &&
	'locale' in value &&
	typeof value.locale === 'string' &&
	'dir' in value &&
	(value.dir === 'ltr' || value.dir === 'rtl');

const escapeAttribute = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** ` lang="…" dir="…"` for the request's locale, or ` lang="<fallback>"`
 *  when no i18n plugin resolved one. */
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
export const registerRequestLocaleGetter = (
	getter: () => RequestLocale | undefined
) => {
	Reflect.set(globalThis, GETTER_KEY, getter);
};
