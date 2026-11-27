import type { AlternateLink } from '../../types/i18n';
import type {
	Metadata,
	PreloadLink,
	SpeculationRules
} from '../../types/metadata';
import { renderFontTags } from './fontAssets';
import { applyIconVersion, iconMimeType } from './iconVersion';
import { nonceAttr, readCspNonce } from './cspNonceRef';
import { scriptTag } from './scriptAttributes';
import { serializeJsonLd } from './jsonLd';
import { escapeAttribute, escapeText, renderRobotsContent } from './headEscape';

const renderOpenGraphTags = (
	openGraph: Metadata['openGraph'],
	title: string,
	description: string
) => {
	if (!openGraph) return [];

	const tags: string[] = [];
	const ogTitle = openGraph.title ?? title;
	const ogDescription = openGraph.description ?? description;

	if (ogTitle)
		tags.push(
			`<meta property="og:title" content="${escapeAttribute(ogTitle)}">`
		);
	if (ogDescription)
		tags.push(
			`<meta property="og:description" content="${escapeAttribute(ogDescription)}">`
		);
	if (openGraph.url)
		tags.push(
			`<meta property="og:url" content="${escapeAttribute(openGraph.url)}">`
		);
	if (openGraph.image)
		tags.push(
			`<meta property="og:image" content="${escapeAttribute(openGraph.image)}">`
		);
	if (openGraph.imageAlt)
		tags.push(
			`<meta property="og:image:alt" content="${escapeAttribute(openGraph.imageAlt)}">`
		);
	if (openGraph.imageWidth)
		tags.push(
			`<meta property="og:image:width" content="${escapeAttribute(openGraph.imageWidth)}">`
		);
	if (openGraph.imageHeight)
		tags.push(
			`<meta property="og:image:height" content="${escapeAttribute(openGraph.imageHeight)}">`
		);
	if (openGraph.type)
		tags.push(
			`<meta property="og:type" content="${escapeAttribute(openGraph.type)}">`
		);
	if (openGraph.siteName)
		tags.push(
			`<meta property="og:site_name" content="${escapeAttribute(openGraph.siteName)}">`
		);
	if (openGraph.locale)
		tags.push(
			`<meta property="og:locale" content="${escapeAttribute(openGraph.locale)}">`
		);

	return tags;
};

const renderTwitterTags = (
	twitter: Metadata['twitter'],
	title: string,
	description: string
) => {
	if (!twitter) return [];

	const tags: string[] = [];
	const twitterTitle = twitter.title ?? title;
	const twitterDescription = twitter.description ?? description;

	if (twitter.card)
		tags.push(
			`<meta name="twitter:card" content="${escapeAttribute(twitter.card)}">`
		);
	if (twitterTitle)
		tags.push(
			`<meta name="twitter:title" content="${escapeAttribute(twitterTitle)}">`
		);
	if (twitterDescription)
		tags.push(
			`<meta name="twitter:description" content="${escapeAttribute(twitterDescription)}">`
		);
	if (twitter.image)
		tags.push(
			`<meta name="twitter:image" content="${escapeAttribute(twitter.image)}">`
		);
	if (twitter.imageAlt)
		tags.push(
			`<meta name="twitter:image:alt" content="${escapeAttribute(twitter.imageAlt)}">`
		);
	if (twitter.site)
		tags.push(
			`<meta name="twitter:site" content="${escapeAttribute(twitter.site)}">`
		);
	if (twitter.creator)
		tags.push(
			`<meta name="twitter:creator" content="${escapeAttribute(twitter.creator)}">`
		);

	return tags;
};

const renderMetaTag = (tag: {
	name?: string;
	property?: string;
	httpEquiv?: string;
	content: string;
}) => {
	if (tag.property)
		return `<meta property="${escapeAttribute(tag.property)}" content="${escapeAttribute(tag.content)}">`;
	if (tag.httpEquiv)
		return `<meta http-equiv="${escapeAttribute(tag.httpEquiv)}" content="${escapeAttribute(tag.content)}">`;
	if (tag.name)
		return `<meta name="${escapeAttribute(tag.name)}" content="${escapeAttribute(tag.content)}">`;

	return undefined;
};

/** `<link rel="alternate" hreflang>` tags for a page's localized versions. */
const renderAlternateLinks = (alternates: AlternateLink[] = []) =>
	alternates.map(
		({ href, hreflang }) =>
			`<link rel="alternate" hreflang="${escapeAttribute(hreflang)}" href="${escapeAttribute(href)}">`
	);

const renderPreloadLink = (preload: PreloadLink) => {
	const rel = preload.module ? 'modulepreload' : 'preload';
	const asAttribute =
		!preload.module && preload.as
			? ` as="${escapeAttribute(preload.as)}"`
			: '';
	const crossoriginAttribute =
		preload.crossorigin !== undefined
			? ` crossorigin="${escapeAttribute(preload.crossorigin)}"`
			: '';

	return `<link rel="${escapeAttribute(rel)}" href="${escapeAttribute(preload.href)}"${asAttribute}${crossoriginAttribute}>`;
};

export const generateHeadElement = ({
	cssPath,
	title = 'AbsoluteJS',
	description = 'A page created using AbsoluteJS',
	font,
	fonts,
	icon = '/assets/ico/favicon.ico',
	canonical,
	alternates,
	openGraph,
	twitter,
	robots,
	meta,
	jsonLd,
	preload,
	scripts,
	speculationRules
}: Metadata = {}) => {
	const tags: string[] = [
		'<meta charset="UTF-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
		`<title>${escapeText(title)}</title>`,
		`<meta name="description" content="${escapeAttribute(description)}">`,
		`<link rel="icon" href="${escapeAttribute(applyIconVersion(icon))}" type="${escapeAttribute(iconMimeType(icon))}">`
	];

	if (canonical) {
		tags.push(
			`<link rel="canonical" href="${escapeAttribute(canonical)}">`
		);
	}

	tags.push(...renderAlternateLinks(alternates));

	tags.push(...renderOpenGraphTags(openGraph, title, description));
	tags.push(...renderTwitterTags(twitter, title, description));

	const robotsContent = robots ? renderRobotsContent(robots) : '';

	if (robotsContent) {
		tags.push(
			`<meta name="robots" content="${escapeAttribute(robotsContent)}">`
		);
	}

	const renderedMeta = (meta ?? [])
		.map(renderMetaTag)
		.filter((tag): tag is string => tag !== undefined);

	tags.push(...renderedMeta);

	if (font) {
		tags.push(
			`<link rel="preconnect" href="https://fonts.googleapis.com">`,
			`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
			`<link href="https://fonts.googleapis.com/css2?family=${escapeAttribute(font)}:wght@100..900&amp;display=swap" rel="stylesheet">`
		);
	}

	if (fonts) {
		tags.push(...renderFontTags(fonts));
	}

	for (const link of preload ?? []) {
		tags.push(renderPreloadLink(link));
	}

	const speculation = speculationRules
		? serializeSpeculationRules(speculationRules)
		: undefined;

	if (speculation) {
		tags.push(
			`<script${nonceAttr()} type="speculationrules">${speculation}</script>`
		);
	}

	const cssPaths = cssPath ? [cssPath].flat() : [];

	for (const path of cssPaths) {
		tags.push(
			`<link rel="stylesheet" href="${escapeAttribute(path)}" type="text/css">`
		);
	}

	if (jsonLd) {
		tags.push(
			`<script${nonceAttr()} type="application/ld+json">${serializeJsonLd(jsonLd)}</script>`
		);
	}

	/* Third-party tags last, after the page's own stylesheets and
	 * metadata: a deferred analytics script should not be fetched ahead of
	 * the CSS that decides what the page looks like. A `lazyOnload` script
	 * renders a small inline bootstrap instead of a tag, since a head
	 * built as a string has no component to run the insertion later. */
	for (const script of scripts ?? []) {
		tags.push(scriptTag(script, readCspNonce()));
	}

	return `<head>\n  ${tags.join('\n  ')}\n</head>` as const;
};
/** Serialize declarative speculation rules to the JSON body of a
 *  `<script type="speculationrules">`. Empty lists are dropped; returns
 *  `undefined` when there is nothing to speculate. `<` is escaped so a
 *  URL can never close the script element early. */
export const serializeSpeculationRules = (rules: SpeculationRules) => {
	const body: Record<string, Array<{ urls: string[] }>> = {};
	if (rules.prerender && rules.prerender.length > 0) {
		body.prerender = [{ urls: rules.prerender }];
	}
	if (rules.prefetch && rules.prefetch.length > 0) {
		body.prefetch = [{ urls: rules.prefetch }];
	}
	if (Object.keys(body).length === 0) return undefined;

	return JSON.stringify(body).replace(/</g, '\\u003c');
};
