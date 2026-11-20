import type { MessageValue } from '../../types/i18n';
import {
	readRequestLocale,
	readRequestTranslate,
	type RequestTranslate
} from '../utils/localeRef';

/* i18n for HTML and HTMX pages.
 *
 * A framework page translates in its own components. An HTML page is a
 * file — the same bytes for every visitor — so there is nothing to call
 * `t()` from. The markup declares what to translate instead, and the
 * server substitutes it on the way out:
 *
 *   <h1 data-i18n="home.title" data-i18n-params='{"name":"Ada"}'></h1>
 *   <img data-i18n-attr="alt:home.hero.alt" src="/hero.webp">
 *
 * The element's own content is replaced, so what is written between the
 * tags is a placeholder for people reading the file — and what ships is
 * the message, never both.
 *
 * Nothing happens without `i18nPlugin()`: no translator is registered, so
 * a page keeps its markup exactly as written. The same pass fills in
 * `<html lang dir>`, which an HTML page could not do for itself either. */

const TEXT_ATTRIBUTE = 'data-i18n';
const ATTR_ATTRIBUTE = 'data-i18n-attr';
const PARAMS_ATTRIBUTE = 'data-i18n-params';

const isMessageValue = (value: unknown): value is MessageValue =>
	typeof value === 'string' ||
	typeof value === 'number' ||
	typeof value === 'bigint' ||
	value instanceof Date;

/* `data-i18n-params='{"count":2}'`. Anything that is not an object of ICU
 * values is ignored rather than thrown: a malformed attribute should cost
 * the message's parameters, not the page. */
const readParams = (raw: string | null) => {
	if (!raw) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return undefined;
		const entries = Object.entries(parsed).filter(([, value]) =>
			isMessageValue(value)
		);

		return Object.fromEntries(entries);
	} catch {
		return undefined;
	}
};

/* `data-i18n-attr="alt:home.hero.alt, title:home.hero.title"` */
const attributePairs = (raw: string) =>
	raw
		.split(',')
		.map((pair) => pair.trim())
		.filter(Boolean)
		.map((pair) => {
			const separator = pair.indexOf(':');
			if (separator <= 0) return undefined;

			return {
				attribute: pair.slice(0, separator).trim(),
				key: pair.slice(separator + 1).trim()
			};
		})
		.filter((pair) => pair !== undefined && pair.key !== '');

const translateText = (
	element: HTMLRewriterTypes.Element,
	translate: RequestTranslate
) => {
	const key = element.getAttribute(TEXT_ATTRIBUTE);
	if (!key) return;
	const params = readParams(element.getAttribute(PARAMS_ATTRIBUTE));
	// Text, not markup: a message is content, and a translator is not a
	// template engine.
	element.setInnerContent(translate(key, params));
};

const translateAttributes = (
	element: HTMLRewriterTypes.Element,
	translate: RequestTranslate
) => {
	const raw = element.getAttribute(ATTR_ATTRIBUTE);
	if (!raw) return;
	const params = readParams(element.getAttribute(PARAMS_ATTRIBUTE));
	attributePairs(raw).forEach((pair) => {
		if (!pair) return;
		element.setAttribute(pair.attribute, translate(pair.key, params));
	});
};

/* An HTML page cannot write its own `lang`: the file is shared by every
 * locale. Left alone when the author set one, so a single-locale page can
 * still say what it is. */
const setDocumentLocale = (element: HTMLRewriterTypes.Element) => {
	const current = readRequestLocale();
	if (!current || element.getAttribute('lang')) return;
	element.setAttribute('lang', current.locale);
	element.setAttribute('dir', current.dir);
};

/** Substitutes `data-i18n` text and `data-i18n-attr` attributes with the
 *  request's messages, and fills in `<html lang dir>`. Returns the html
 *  unchanged when no locale was resolved for this request. */
export const translateStaticHtml = async (html: string) => {
	const translate = readRequestTranslate();
	const locale = readRequestLocale();
	if (!translate && !locale) return html;
	const rewriter = new HTMLRewriter();
	if (locale) rewriter.on('html', { element: setDocumentLocale });
	if (translate) {
		rewriter
			.on(`[${TEXT_ATTRIBUTE}]`, {
				element: (element) => translateText(element, translate)
			})
			.on(`[${ATTR_ATTRIBUTE}]`, {
				element: (element) => translateAttributes(element, translate)
			});
	}

	return rewriter.transform(new Response(html)).text();
};
