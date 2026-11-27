/* Whether a page can be cited, as well as read.
 *
 * An answer engine that quotes a page wants to say whose words they
 * are, when they were written, and where the page is. Those come from
 * the page's head and its JSON-LD, and a page can be perfectly readable
 * with none of them: an article with no author can be quoted, and not
 * attributed.
 *
 * This reads one page's HTML and says what is missing. It reads the
 * HTML rather than the route's `metadata`, so it sees JSON-LD however
 * it got onto the page — route metadata, a `JsonLd` component, or a
 * script tag written by hand — in any framework.
 *
 * What it says is advice. Whether an article needs a named author is
 * the site's call, so these are not findings unless asked to be
 * (`absolute content --strict`). */

const JSON_LD_RE =
	/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
const ARTICLE_TYPES = new Set(['Article', 'BlogPosting', 'NewsArticle']);

type Thing = Record<string, unknown>;

const isThing = (value: unknown): value is Thing =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const listOf = (value: unknown) =>
	value === undefined || value === null ? [] : [value].flat();

/* A block is one thing, a list of them, or a `@graph` of them. */
const thingsOf = (value: unknown): Thing[] =>
	listOf(value)
		.filter(isThing)
		.flatMap((thing) =>
			'@graph' in thing ? thingsOf(thing['@graph']) : [thing]
		);

type Parsed = { invalid: number; things: Thing[] };

const parseBlock = (parsed: Parsed, [, json = '']: RegExpMatchArray) => {
	try {
		const things: unknown = JSON.parse(json);
		const next: Parsed = {
			invalid: parsed.invalid,
			things: [...parsed.things, ...thingsOf(things)]
		};

		return next;
	} catch {
		const next: Parsed = {
			invalid: parsed.invalid + 1,
			things: parsed.things
		};

		return next;
	}
};

const typesOf = (thing: Thing) =>
	listOf(thing['@type']).filter(
		(type): type is string => typeof type === 'string'
	);

const isArticle = (thing: Thing) =>
	typesOf(thing).some((type) => ARTICLE_TYPES.has(type));

const hasText = (value: unknown) =>
	typeof value === 'string' && value.trim() !== '';

/* An author is someone with a name: a string, or a Person or an
 * Organization that has one. */
const isNamed = (value: unknown) =>
	hasText(value) || (isThing(value) && hasText(value.name));

const articleGaps = (article: Thing) => {
	const [type = 'Article'] = typesOf(article);
	const missing = [
		...(hasText(article.headline) ? [] : ['headline']),
		...(listOf(article.author).some(isNamed) ? [] : ['named author']),
		...(hasText(article.datePublished) ? [] : ['datePublished']),
		...(hasText(article.dateModified) ? [] : ['dateModified'])
	];

	return missing.length === 0
		? []
		: [`its ${type} has no ${missing.join(', no ')}`];
};

const HEAD_RE = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i;
const TITLE_RE = /<title\b[^>]*>\s*[^<\s][^<]*<\/title\s*>/i;
const DESCRIPTION_RE =
	/<meta\b(?=[^>]*\bname\s*=\s*["']description["'])(?=[^>]*\bcontent\s*=\s*["'][^"']*\S[^"']*["'])[^>]*>/i;
const CANONICAL_RE =
	/<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])(?=[^>]*\bhref\s*=\s*["'][^"']+["'])[^>]*>/i;

const headGaps = (html: string) => {
	const [, head = html] = HEAD_RE.exec(html) ?? [];

	return [
		...(TITLE_RE.test(head) ? [] : ['no title']),
		...(DESCRIPTION_RE.test(head) ? [] : ['no description']),
		...(CANONICAL_RE.test(head) ? [] : ['no canonical address'])
	];
};

/** What a page is missing for an answer that quotes it to say whose
 *  words they are and where they came from. */
export const auditCitation = (html: string) => {
	const { invalid, things } = [...html.matchAll(JSON_LD_RE)].reduce(
		parseBlock,
		{ invalid: 0, things: [] }
	);

	return [
		...headGaps(html),
		...(invalid === 0
			? []
			: [
					`${invalid} JSON-LD block${invalid === 1 ? '' : 's'} that could not be parsed`
				]),
		...things.filter(isArticle).flatMap(articleGaps)
	];
};
