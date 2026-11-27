import type { RobotsDirective } from '../../types/metadata';

/* Everything a page passes as metadata ends up inside this string, and
 * most of it is not written by the developer: a product name becomes the
 * title, a post's summary the description, a slug the canonical URL.
 * None of it was escaped: text in a title could close the element and
 * continue as markup, and a double quote in any attribute value closed
 * the attribute. Only the `hreflang` links were escaped.
 *
 * An `&` that already begins a character reference is left alone. Until
 * now the only way to get a safe title was to escape it by hand, and
 * re-escaping those would turn every `&amp;` on such a site into a
 * visible `&amp;amp;`. Leaving a reference in place is safe: inside an
 * attribute value or a title it decodes to a character, never to
 * markup. */
const BARE_AMPERSAND = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#[xX][0-9a-fA-F]+);)/g;

export const escapeAttribute = (value: string | number) =>
	escapeText(String(value)).replace(/"/g, '&quot;');

export const escapeText = (value: string) =>
	value
		.replace(BARE_AMPERSAND, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');

export const renderRobotsContent = (robots: RobotsDirective) => {
	const directives: string[] = [];
	if (robots.index === false) directives.push('noindex');
	if (robots.index === true) directives.push('index');
	if (robots.follow === false) directives.push('nofollow');
	if (robots.follow === true) directives.push('follow');
	if (robots.noarchive) directives.push('noarchive');
	if (robots.nosnippet) directives.push('nosnippet');
	if (robots.noimageindex) directives.push('noimageindex');
	if (robots.maxSnippet !== undefined)
		directives.push(`max-snippet:${robots.maxSnippet}`);
	if (robots.maxImagePreview)
		directives.push(`max-image-preview:${robots.maxImagePreview}`);
	if (robots.maxVideoPreview !== undefined)
		directives.push(`max-video-preview:${robots.maxVideoPreview}`);

	return directives.join(', ');
};
