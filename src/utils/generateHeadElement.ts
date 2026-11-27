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
import {
	escapeHeadAttribute,
	escapeHeadText,
	renderRobotsContent
} from './headEscape';

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
			`<meta property="og:title" content="${escapeHeadAttribute(ogTitle)}">`
		);
	if (ogDescription)
		tags.push(
			`<meta property="og:description" content="${escapeHeadAttribute(ogDescription)}">`
		);
	if (openGraph.url)
		tags.push(
			`<meta property="og:url" content="${escapeHeadAttribute(openGraph.url)}">`
		);
	if (openGraph.image)
		tags.push(
			`<meta property="og:image" content="${escapeHeadAttribute(openGraph.image)}">`
		);
	if (openGraph.imageAlt)
		tags.push(
			`<meta property="og:image:alt" content="${escapeHeadAttribute(openGraph.imageAlt)}">`
		);
	if (openGraph.imageWidth)
		tags.push(
			`<meta property="og:image:width" content="${escapeHeadAttribute(openGraph.imageWidth)}">`
		);
	if (openGraph.imageHeight)
		tags.push(
			`<meta property="og:image:height" content="${escapeHeadAttribute(openGraph.imageHeight)}">`
		);
	if (openGraph.type)
		tags.push(
			`<meta property="og:type" content="${escapeHeadAttribute(openGraph.type)}">`
		);
	if (openGraph.siteName)
		tags.push(
			`<meta property="og:site_name" content="${escapeHeadAttribute(openGraph.siteName)}">`
		);
	if (openGraph.locale)
		tags.push(
			`<meta property="og:locale" content="${escapeHeadAttribute(openGraph.locale)}">`
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
			`<meta name="twitter:card" content="${escapeHeadAttribute(twitter.card)}">`
		);
	if (twitterTitle)
		tags.push(
			`<meta name="twitter:title" content="${escapeHeadAttribute(twitterTitle)}">`
		);
	if (twitterDescription)
		tags.push(
			`<meta name="twitter:description" content="${escapeHeadAttribute(twitterDescription)}">`
		);
	if (twitter.image)
		tags.push(
			`<meta name="twitter:image" content="${escapeHeadAttribute(twitter.image)}">`
		);
	if (twitter.imageAlt)
		tags.push(
			`<meta name="twitter:image:alt" content="${escapeHeadAttribute(twitter.imageAlt)}">`
		);
	if (twitter.site)
		tags.push(
			`<meta name="twitter:site" content="${escapeHeadAttribute(twitter.site)}">`
		);
	if (twitter.creator)
		tags.push(
			`<meta name="twitter:creator" content="${escapeHeadAttribute(twitter.creator)}">`
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
		return `<meta property="${escapeHeadAttribute(tag.property)}" content="${escapeHeadAttribute(tag.content)}">`;
	if (tag.httpEquiv)
		return `<meta http-equiv="${escapeHeadAttribute(tag.httpEquiv)}" content="${escapeHeadAttribute(tag.content)}">`;
	if (tag.name)
		return `<meta name="${escapeHeadAttribute(tag.name)}" content="${escapeHeadAttribute(tag.content)}">`;

	return undefined;
};

/** `<link rel="alternate" hreflang>` tags for a page's localized versions. */
const renderAlternateLinks = (alternates: AlternateLink[] = []) =>
	alternates.map(
		({ href, hreflang }) =>
			`<link rel="alternate" hreflang="${escapeHeadAttribute(hreflang)}" href="${escapeHeadAttribute(href)}">`
	);

const renderPreloadLink = (preload: PreloadLink) => {
	const rel = preload.module ? 'modulepreload' : 'preload';
	const asAttribute =
		!preload.module && preload.as
			? ` as="${escapeHeadAttribute(preload.as)}"`
			: '';
	const crossoriginAttribute =
		preload.crossorigin !== undefined
			? ` crossorigin="${escapeHeadAttribute(preload.crossorigin)}"`
			: '';

	return `<link rel="${escapeHeadAttribute(rel)}" href="${escapeHeadAttribute(preload.href)}"${asAttribute}${crossoriginAttribute}>`;
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
		`<title>${escapeHeadText(title)}</title>`,
		`<meta name="description" content="${escapeHeadAttribute(description)}">`,
		`<link rel="icon" href="${escapeHeadAttribute(applyIconVersion(icon))}" type="${escapeHeadAttribute(iconMimeType(icon))}">`
	];

	if (canonical) {
		tags.push(
			`<link rel="canonical" href="${escapeHeadAttribute(canonical)}">`
		);
	}

	tags.push(...renderAlternateLinks(alternates));

	tags.push(...renderOpenGraphTags(openGraph, title, description));
	tags.push(...renderTwitterTags(twitter, title, description));

	const robotsContent = robots ? renderRobotsContent(robots) : '';

	if (robotsContent) {
		tags.push(
			`<meta name="robots" content="${escapeHeadAttribute(robotsContent)}">`
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
			`<link href="https://fonts.googleapis.com/css2?family=${escapeHeadAttribute(font)}:wght@100..900&amp;display=swap" rel="stylesheet">`
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
			`<link rel="stylesheet" href="${escapeHeadAttribute(path)}" type="text/css">`
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
