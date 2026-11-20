import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'HTML and HTMX pages can now be localized, which only the four framework targets could before. A page is a file — the same bytes for every visitor — so there is nothing to call t() from; the markup declares what to translate and the server substitutes it on the way out. `data-i18n="home.title"` replaces the element\'s content, so the text written between the tags is a placeholder for whoever reads the file and never ships beside the message; `data-i18n-attr="alt:home.hero.alt, title:home.hero.title"` sets attributes; `data-i18n-params=\'{"count":2}\'` carries ICU parameters, and a malformed one costs the parameters rather than the page. A missing message renders its key, which is how it gets noticed. Substituted text is escaped: a message is content, not a template. The same pass fills in `<html lang dir>` from the request locale unless the author set `lang`, which an HTML file could not do for itself — the third and last place that shipped a bare `<html>`. Nothing happens without i18nPlugin(): no translator is registered and the markup ships exactly as written.',
	kind: 'added',
	summary: 'HTML and HTMX pages can be localized',
	symbols: ['handleHTMLPageRequest', 'handleHTMXPageRequest']
};
