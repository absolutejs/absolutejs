import {
	currentFileRoute,
	currentRouteHead,
	type NotedHeadTag
} from '../utils/fileRouteRef';
import { logWarn } from '../utils/logger';
import { isDevelopmentRuntime } from '../utils/runtimeMode';

/* Putting a route's metadata into the document it is for.
 *
 * A file route's `metadata` becomes tags (utils/routeMetadata.ts), and
 * they have to end up in the `<head>` of a page that one of six kinds
 * of handler rendered, each in its own way: React streams a document
 * the page component wrote, Svelte composes a head from the render, Vue
 * and Angular are handed one, HTML is a file. Nothing they share exists
 * until the response does — so this works on the response, in the one
 * place all of them pass through (pageResponseCache.ts), and none of
 * the handlers knows about it.
 *
 * TWO THINGS HAPPEN TO THE HEAD.
 *
 * - The route's tags are added, at the end of it.
 * - A tag already there that one of them replaces is removed: the
 *   page's own `<title>`, a `<meta name="description">` written by
 *   hand. The route's wins, on every kind of page, so that what a
 *   layout sets cannot be overridden by accident from inside a page —
 *   and so that a document never has two. Browsers take the first
 *   `<title>`; nothing obliges a crawler to take the first description
 *   or canonical link.
 *
 * A streamed page's head need not be in its first chunk — React cuts
 * chunks at a fixed size, and a head with inline styles runs past it —
 * so the stream is held until `</head>` has been seen, and let go from
 * there. A document with no head, or one that large, is sent as it
 * is. */

const HEAD_CLOSE_RE = /<\/head\s*>/i;
const TITLE_RE = /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi;
const META_RE = /<meta\b[^>]*>/gi;
const LINK_RE = /<link\b[^>]*>/gi;
/* Past this, a document's head is not what is being looked at. */
const MAX_HEAD_BYTES = 512_000;

const escapeForRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasAttribute = (tag: string, name: string, value: string) =>
	new RegExp(
		`\\s${name}\\s*=\\s*(?:"${escapeForRegExp(value)}"|'${escapeForRegExp(value)}'|${escapeForRegExp(value)}(?=[\\s/>]))`,
		'i'
	).test(tag);

type Removal = { pattern: RegExp; test: (tag: string) => boolean };

/* What an identity removes from a head: which tags to look at, and
 * which of them it is. */
const always = () => true;

const metaRemoval = (attribute: string, value: string) => {
	const removal: Removal = {
		pattern: META_RE,
		test: (tag) => hasAttribute(tag, attribute, value)
	};

	return removal;
};

const linkRemoval = (test: Removal['test']) => {
	const removal: Removal = { pattern: LINK_RE, test };

	return removal;
};

const removalFor = (identity: string) => {
	const title: Removal = { pattern: TITLE_RE, test: always };
	if (identity === 'title') return title;
	if (identity === 'link:canonical')
		return linkRemoval((tag) => hasAttribute(tag, 'rel', 'canonical'));
	const [kind, attribute, ...rest] = identity.split(':');
	const value = rest.join(':');
	if (kind === 'meta' && attribute) return metaRemoval(attribute, value);
	if (kind === 'link' && attribute === 'alternate')
		return linkRemoval(
			(tag) =>
				hasAttribute(tag, 'rel', 'alternate') &&
				hasAttribute(tag, 'hreflang', value)
		);

	return undefined;
};

type Rewritten = { dropped: string[]; head: string };

const dropTagsOf = ({ dropped, head }: Rewritten, identity: string) => {
	const removal = removalFor(identity);
	if (!removal) return { dropped, head };
	const found: string[] = [];
	const next = head.replace(removal.pattern, (tag) => {
		if (!removal.test(tag)) return tag;
		found.push(tag);

		return '';
	});
	const rewritten: Rewritten = {
		dropped: found.length > 0 ? [...dropped, identity] : dropped,
		head: next
	};

	return rewritten;
};

/** `html` — a document up to and including its `</head>` — with the
 *  route's tags in its head, and what they replaced taken out. Returns
 *  the identities that were replaced, for the warning. */
export const rewriteHead = (html: string, tags: readonly NotedHeadTag[]) => {
	const close = HEAD_CLOSE_RE.exec(html);
	if (!close) return { dropped: [], html };
	const before = html.slice(0, close.index);
	const identities = [...new Set(tags.flatMap((tag) => tag.identity ?? []))];
	const { dropped, head } = identities.reduce<Rewritten>(dropTagsOf, {
		dropped: [],
		head: before
	});

	return {
		dropped,
		html: `${head}${tags.map((tag) => tag.html).join('')}${html.slice(close.index)}`
	};
};

const warned = new Set<string>();

/* In development, once per route and tag: the page wrote a tag its
 * route's metadata also sets. The route's was used; the page's is dead
 * code that will mislead whoever edits it next. */
const warnReplaced = (dropped: string[]) => {
	if (!isDevelopmentRuntime() || dropped.length === 0) return;
	const route = currentFileRoute() ?? 'a file route';
	dropped
		.filter((identity) => !warned.has(`${route}:${identity}`))
		.forEach((identity) => {
			warned.add(`${route}:${identity}`);
			logWarn(
				`${route}: the page renders its own ${identity.replace(/^(meta|link):/, '').replace(':', ' ')} tag, and the route's \`metadata\` sets it too. The document is sent with the route's, but a page that renders the tag puts its own back once it hydrates. Remove the tag from the page.`
			);
		});
};

type Held = { bytes: Uint8Array; done: boolean };

const joined = (left: Uint8Array, right: Uint8Array) => {
	const both = new Uint8Array(left.length + right.length);
	both.set(left);
	both.set(right, left.length);

	return both;
};

/* The bytes held so far, with the head rewritten — or undefined while
 * `</head>` has not arrived.
 *
 * Only the head is decoded and written again. What follows it goes out
 * as the bytes it came in as: a chunk boundary can fall in the middle
 * of a character, and decoding the tail of a chunk to re-encode it
 * would lose the half that has not arrived. Up to `</head>` there is no
 * such half — the tag is ASCII, so whatever precedes it is whole. */
const headRewritten = (bytes: Uint8Array, tags: readonly NotedHeadTag[]) => {
	const text = new TextDecoder().decode(bytes);
	const close = HEAD_CLOSE_RE.exec(text);
	if (!close) return undefined;
	const upToHead = text.slice(0, close.index + close[0].length);
	const encoder = new TextEncoder();
	const { dropped, html } = rewriteHead(upToHead, tags);
	warnReplaced(dropped);

	return joined(
		encoder.encode(html),
		bytes.subarray(encoder.encode(upToHead).length)
	);
};

/* The body with the route's tags in its head: held until `</head>`
 * has arrived, rewritten once, and passed through from there. */
const rewriteStream = (
	body: ReadableStream<Uint8Array>,
	tags: readonly NotedHeadTag[]
) => {
	const held: Held = { bytes: new Uint8Array(), done: false };
	const release = (
		controller: TransformStreamDefaultController<Uint8Array>,
		bytes: Uint8Array
	) => {
		held.done = true;
		held.bytes = new Uint8Array();
		if (bytes.length > 0) controller.enqueue(bytes);
	};

	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			flush(controller) {
				// Ended with no `</head>`: whatever it was, as it was.
				if (!held.done) release(controller, held.bytes);
			},
			transform(chunk, controller) {
				if (held.done) {
					controller.enqueue(chunk);

					return;
				}
				held.bytes = joined(held.bytes, chunk);
				const rewritten = headRewritten(held.bytes, tags);
				if (rewritten || held.bytes.length > MAX_HEAD_BYTES)
					release(controller, rewritten ?? held.bytes);
			}
		})
	);
};

/** `response`, an HTML page, with the head tags the current request's
 *  route asked for. Unchanged when the route asked for none, or the
 *  response is not a page that was rendered (an error page keeps its
 *  own head: it is not the page the metadata describes). */
export const withRouteHead = (response: Response) => {
	const tags = currentRouteHead();
	if (!tags || tags.length === 0 || !response.ok || !response.body)
		return response;
	const headers = new Headers(response.headers);
	// The body's length changes.
	headers.delete('content-length');

	return new Response(rewriteStream(response.body, tags), {
		headers,
		status: response.status,
		statusText: response.statusText
	});
};
