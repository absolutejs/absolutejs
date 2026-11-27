/* What a page says to a reader that runs no JavaScript.
 *
 * Most crawlers run for language models fetch a page's HTML and read
 * it; they do not run its scripts. What such a reader gets is the text
 * in the response, and three things this framework can do leave some of
 * a page's text out of it:
 *
 *   - A page with `ssr: false` is a document shell. Everything on it is
 *     rendered in the browser.
 *   - A streamed slot is sent as its fallback, and its content follows
 *     in the same response as a `<script>` that swaps it in. The
 *     content is in the bytes and not in the text.
 *   - A dynamic hole of a page served in edge mode is fetched by a
 *     second request the page's own script makes.
 *
 * This reads one response and says how many words a reader gets and
 * which of those happened. It is told nothing about the page's source,
 * so it also sees the fourth and commonest case, which no scan of the
 * source can: a component that renders nothing until it has fetched its
 * data in the browser. That one has no marker. It shows as a page with
 * few words, or none. */

/** Why a page's text is not all in its HTML. */
export type ContentFindingKind =
	'below-minimum' | 'client-only' | 'empty' | 'holes' | 'slots';

export type ContentFinding = { kind: ContentFindingKind; message: string };

/** What one response says to a reader that runs no JavaScript. */
export type PageContent = {
	/** Reasons the page fails the audit. */
	findings: ContentFinding[];
	/** Things worth knowing that are not failures. */
	notes: string[];
	/** Words of text in the document's body. */
	words: number;
};

export type AuditContentOptions = {
	/** A page with fewer words than this is a finding. */
	minWords?: number;
};

const CLIENT_ONLY_MARK = '__ABSOLUTE_PAGE_RENDER_MODE__="client"';
const HOLES_MARK = '"__absolute_holes"';
/* A slot's element, in every framework's markup. One is not a finding
 * by itself: a slot rendered in place holds its content. */
const SLOT_RE = /data-absolute-slot="true"/g;
/* The script that swaps a slot's content in (utils/streamingSlots.ts):
 * one per slot whose content was streamed after the page. */
const SLOT_PATCH_RE = /__ABS_SLOT_PENDING__\[i\]=p;\}\)\("/g;
/* React's marker for a Suspense boundary that was still pending when
 * the shell was sent. */
const PENDING_BOUNDARY_RE = /<!--\$\?-->/g;

/* Elements whose content is not text a reader is shown. `<noscript>`
 * is not among them: it is exactly what this reader is shown. */
const UNREAD_ELEMENTS_RE =
	/<(script|style|template|svg|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	nbsp: ' ',
	quot: '"'
};

const decodeEntity = (match: string, name: string) =>
	NAMED_ENTITIES[name.toLowerCase()] ?? match;

const WORD_RE = /[\p{L}\p{N}]/u;

const countWords = (text: string) =>
	text === ''
		? 0
		: text.split(' ').filter((token) => WORD_RE.test(token)).length;

const count = (html: string, pattern: RegExp) =>
	(html.match(pattern) ?? []).length;

const plural = (amount: number, noun: string) =>
	`${amount} ${noun}${amount === 1 ? '' : 's'}`;

const slotFinding = (slots: number, hasHoles: boolean) => {
	if (slots === 0) return [];
	const finding: ContentFinding = hasHoles
		? {
				kind: 'holes',
				message: `${plural(slots, 'dynamic part')} loaded by a second request the page’s script makes`
			}
		: {
				kind: 'slots',
				message: `${plural(slots, 'streamed slot')} shown as ${slots === 1 ? 'its' : 'their'} fallback; the content arrives in a script`
			};

	return [finding];
};

const sizeFinding = (
	words: number,
	isClientOnly: boolean,
	minWords: number
) => {
	if (isClientOnly) return [];
	if (words === 0) {
		const finding: ContentFinding = {
			kind: 'empty',
			message: 'no text in the HTML'
		};

		return [finding];
	}
	if (words >= minWords) return [];
	const finding: ContentFinding = {
		kind: 'below-minimum',
		message: `fewer than ${plural(minWords, 'word')}`
	};

	return [finding];
};

/** Reads one page's HTML as a reader that runs no JavaScript would. */
export const auditContent = (
	html: string,
	{ minWords = 0 }: AuditContentOptions = {}
) => {
	const words = countWords(visibleText(html));
	const isClientOnly = html.includes(CLIENT_ONLY_MARK);
	const hasHoles = html.includes(HOLES_MARK);
	const pending = count(html, PENDING_BOUNDARY_RE);
	const clientOnly: ContentFinding[] = isClientOnly
		? [
				{
					kind: 'client-only',
					message: 'not rendered on the server (ssr: false)'
				}
			]
		: [];
	const content: PageContent = {
		findings: [
			...clientOnly,
			...slotFinding(
				hasHoles ? count(html, SLOT_RE) : count(html, SLOT_PATCH_RE),
				hasHoles
			),
			...sizeFinding(words, isClientOnly, minWords)
		],
		notes:
			pending === 0
				? []
				: [
						`${pending} Suspense ${pending === 1 ? 'boundary' : 'boundaries'} streamed after the shell: the content is in the HTML, in a hidden element a script moves into place`
					],
		words
	};

	return content;
};

/** The paths a sitemap lists, whatever origin it was written with. */
export const sitemapPaths = (xml: string) =>
	[...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].flatMap(([, loc]) => {
		if (loc === undefined) return [];
		try {
			const { pathname, search } = new URL(
				loc.replace(/&amp;/g, '&'),
				'http://localhost'
			);

			return [`${pathname}${search}`];
		} catch {
			return [];
		}
	});

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* An Elysia path as a pattern: `:name` and `:name?` are one segment,
 * `*` is the rest. */
const routePattern = (path: string) =>
	new RegExp(
		`^${path
			.split('/')
			.map((segment) => {
				if (segment === '*') return '.*';
				if (segment.startsWith(':')) return '[^/]+';

				return escapeRegExp(segment);
			})
			.join('/')}/?$`
	);

/** The dynamic routes among `routePaths` that none of `checked` is a
 *  page of: the ones an audit of `checked` says nothing about. */
export const uncoveredRoutes = (
	routePaths: readonly string[],
	checked: readonly string[]
) =>
	[...new Set(routePaths)]
		.filter((path) => /[:*]/.test(path))
		.filter((path) => {
			const pattern = routePattern(path);

			return !checked.some((url) =>
				pattern.test(url.split('?')[0] ?? url)
			);
		})
		.sort();

/** The text a reader that runs no JavaScript is shown: the body's,
 *  without scripts, styles, templates and markup. */
export const visibleText = (html: string) =>
	html
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(UNREAD_ELEMENTS_RE, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&([a-z]+);/gi, decodeEntity)
		.replace(/&#x?[0-9a-f]+;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
