import type { MetaTag } from '../../types/metadata';
import type { RouteMetadata, RouteTitle } from '../../types/routeMetadata';
import { escapeAttribute, escapeText, renderRobotsContent } from './headEscape';
import { serializeJsonLd } from './jsonLd';

/* A file route's metadata, from what its modules export to the tags
 * that go in the document's head.
 *
 * `metadata` may be exported by a route's server module and by the
 * `layout.server` module of each folder above it. They are merged
 * outermost first, a nearer one over a farther one, the way layouts
 * nest: a layout says what holds for everything below it, and a route
 * says what is its own.
 *
 * Every tag made here carries `data-absolute-meta`, and has an identity
 * — its title-ness, its `name`, its `property`. The identity is what
 * lets a tag the page wrote by hand be found and dropped in favour of
 * the route's (core/routeHead.ts), and the attribute is what lets the
 * browser replace exactly these when a page is handed new data without
 * a document load (client/refreshInPlace.ts). */

export const ROUTE_META_ATTRIBUTE = 'data-absolute-meta';

/** One tag for the head, and what it is the only one of. Tags with no
 *  identity (a JSON-LD block) are never deduplicated. */
export type RouteHeadTag = { html: string; identity?: string };

type TitleState = { template?: string; title?: string };

const applyTemplate = (template: string | undefined, title: string) =>
	template === undefined ? title : template.replace(/%s/g, title);

/* One level's `title`, on top of what the levels above it settled.
 *
 * A string is this level's title, formed by the nearest template above.
 * `absolute` ignores templates. `default` is the title for a route
 * below that sets none, and is not itself templated: it is the name of
 * the section, not a page in it. `template` is for the levels below,
 * never for the level that declares it. */
const titleAt = (state: TitleState, title: RouteTitle | undefined) => {
	if (title === undefined) return state;
	if (typeof title === 'string') {
		const next: TitleState = {
			...state,
			title: applyTemplate(state.template, title)
		};

		return next;
	}
	const settled = title.absolute ?? title.default ?? state.title;
	const next: TitleState = {
		template: title.template ?? state.template,
		...(settled === undefined ? {} : { title: settled })
	};

	return next;
};

const metaIdentity = (tag: MetaTag) => {
	if (tag.property) return `meta:property:${tag.property}`;
	if (tag.httpEquiv) return `meta:http-equiv:${tag.httpEquiv}`;

	return tag.name ? `meta:name:${tag.name}` : undefined;
};

/* A nearer level's custom tag replaces a farther one's of the same
 * name; the rest accumulate. */
const mergeMeta = (outer: MetaTag[] = [], inner: MetaTag[] = []) => {
	const replaced = new Set(inner.flatMap((tag) => metaIdentity(tag) ?? []));

	return [
		...outer.filter((tag) => !replaced.has(metaIdentity(tag) ?? '')),
		...inner
	];
};

/** What a route's metadata comes to: the title settled, the rest
 *  merged. */
export type ResolvedRouteMetadata = Omit<RouteMetadata, 'title'> & {
	title?: string;
};

type Merging = { merged: ResolvedRouteMetadata; title: TitleState };

const mergeLevel = ({ merged, title }: Merging, level: RouteMetadata) => {
	const { title: levelTitle, ...rest } = level;
	const meta = mergeMeta(merged.meta, rest.meta);
	const next: Merging = {
		merged: {
			...merged,
			...rest,
			...(meta.length > 0 ? { meta } : {}),
			...(merged.openGraph || rest.openGraph
				? { openGraph: { ...merged.openGraph, ...rest.openGraph } }
				: {}),
			...(merged.robots || rest.robots
				? { robots: { ...merged.robots, ...rest.robots } }
				: {}),
			...(merged.twitter || rest.twitter
				? { twitter: { ...merged.twitter, ...rest.twitter } }
				: {})
		},
		title: titleAt(title, levelTitle)
	};

	return next;
};

/** Merges a route's metadata levels, outermost first. */
export const mergeRouteMetadata = (levels: readonly RouteMetadata[]) => {
	const { merged, title } = levels.reduce<Merging>(mergeLevel, {
		merged: {},
		title: {}
	});
	const resolved: ResolvedRouteMetadata = {
		...merged,
		...(title.title === undefined ? {} : { title: title.title })
	};

	return resolved;
};

const MARK = ` ${ROUTE_META_ATTRIBUTE}=""`;

const metaByName = (name: string, content: string | number | undefined) =>
	content === undefined || content === ''
		? []
		: [
				{
					html: `<meta name="${escapeAttribute(name)}" content="${escapeAttribute(content)}"${MARK}>`,
					identity: `meta:name:${name}`
				}
			];

const metaByProperty = (
	property: string,
	content: string | number | undefined
) =>
	content === undefined || content === ''
		? []
		: [
				{
					html: `<meta property="${escapeAttribute(property)}" content="${escapeAttribute(content)}"${MARK}>`,
					identity: `meta:property:${property}`
				}
			];

const customMeta = (tag: MetaTag) => {
	if (tag.property) return metaByProperty(tag.property, tag.content);
	if (tag.name) return metaByName(tag.name, tag.content);
	if (!tag.httpEquiv) return [];

	return [
		{
			html: `<meta http-equiv="${escapeAttribute(tag.httpEquiv)}" content="${escapeAttribute(tag.content)}"${MARK}>`,
			identity: `meta:http-equiv:${tag.httpEquiv}`
		}
	];
};

/* Open Graph and Twitter fall back to the page's own title and
 * description, as they do in `generateHeadElement`: a card with no
 * title of its own is about the page. */
const openGraphTags = ({
	description,
	openGraph,
	title
}: ResolvedRouteMetadata) =>
	openGraph === undefined
		? []
		: [
				...metaByProperty('og:title', openGraph.title ?? title),
				...metaByProperty(
					'og:description',
					openGraph.description ?? description
				),
				...metaByProperty('og:url', openGraph.url),
				...metaByProperty('og:image', openGraph.image),
				...metaByProperty('og:image:alt', openGraph.imageAlt),
				...metaByProperty('og:image:width', openGraph.imageWidth),
				...metaByProperty('og:image:height', openGraph.imageHeight),
				...metaByProperty('og:type', openGraph.type),
				...metaByProperty('og:site_name', openGraph.siteName),
				...metaByProperty('og:locale', openGraph.locale)
			];

const twitterTags = ({ description, title, twitter }: ResolvedRouteMetadata) =>
	twitter === undefined
		? []
		: [
				...metaByName('twitter:card', twitter.card),
				...metaByName('twitter:title', twitter.title ?? title),
				...metaByName(
					'twitter:description',
					twitter.description ?? description
				),
				...metaByName('twitter:image', twitter.image),
				...metaByName('twitter:image:alt', twitter.imageAlt),
				...metaByName('twitter:site', twitter.site),
				...metaByName('twitter:creator', twitter.creator)
			];

/** The tags a route's resolved metadata puts in the head, in the order
 *  they are written. Only what was given: nothing is defaulted, so a
 *  route that sets a title adds a title and nothing else. */
export const routeHeadTags = (metadata: ResolvedRouteMetadata) => {
	const { alternates, canonical, description, jsonLd, meta, robots, title } =
		metadata;
	const tags: RouteHeadTag[] = [
		...(title === undefined
			? []
			: [
					{
						html: `<title${MARK}>${escapeText(title)}</title>`,
						identity: 'title'
					}
				]),
		...metaByName('description', description),
		...(canonical
			? [
					{
						html: `<link rel="canonical" href="${escapeAttribute(canonical)}"${MARK}>`,
						identity: 'link:canonical'
					}
				]
			: []),
		...(alternates ?? []).map(({ href, hreflang }) => ({
			html: `<link rel="alternate" hreflang="${escapeAttribute(hreflang)}" href="${escapeAttribute(href)}"${MARK}>`,
			identity: `link:alternate:${hreflang}`
		})),
		...openGraphTags(metadata),
		...twitterTags(metadata),
		...metaByName('robots', robots ? renderRobotsContent(robots) : ''),
		...(meta ?? []).flatMap(customMeta),
		...(jsonLd
			? [
					{
						html: `<script type="application/ld+json"${MARK}>${serializeJsonLd(jsonLd)}</script>`
					}
				]
			: [])
	];

	return tags;
};
