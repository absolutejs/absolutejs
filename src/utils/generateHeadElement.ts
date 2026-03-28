import type { Metadata, RobotsDirective } from '../../types/metadata';

const renderRobotsContent = (robots: RobotsDirective) => {
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

const renderOpenGraphTags = (
	openGraph: Metadata['openGraph'],
	title: string,
	description: string
) => {
	if (!openGraph) return [];

	const tags: string[] = [];
	const ogTitle = openGraph.title ?? title;
	const ogDescription = openGraph.description ?? description;

	if (ogTitle) tags.push(`<meta property="og:title" content="${ogTitle}">`);
	if (ogDescription)
		tags.push(
			`<meta property="og:description" content="${ogDescription}">`
		);
	if (openGraph.url)
		tags.push(`<meta property="og:url" content="${openGraph.url}">`);
	if (openGraph.image)
		tags.push(`<meta property="og:image" content="${openGraph.image}">`);
	if (openGraph.imageAlt)
		tags.push(
			`<meta property="og:image:alt" content="${openGraph.imageAlt}">`
		);
	if (openGraph.imageWidth)
		tags.push(
			`<meta property="og:image:width" content="${openGraph.imageWidth}">`
		);
	if (openGraph.imageHeight)
		tags.push(
			`<meta property="og:image:height" content="${openGraph.imageHeight}">`
		);
	if (openGraph.type)
		tags.push(`<meta property="og:type" content="${openGraph.type}">`);
	if (openGraph.siteName)
		tags.push(
			`<meta property="og:site_name" content="${openGraph.siteName}">`
		);
	if (openGraph.locale)
		tags.push(`<meta property="og:locale" content="${openGraph.locale}">`);

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
		tags.push(`<meta name="twitter:card" content="${twitter.card}">`);
	if (twitterTitle)
		tags.push(`<meta name="twitter:title" content="${twitterTitle}">`);
	if (twitterDescription)
		tags.push(
			`<meta name="twitter:description" content="${twitterDescription}">`
		);
	if (twitter.image)
		tags.push(`<meta name="twitter:image" content="${twitter.image}">`);
	if (twitter.imageAlt)
		tags.push(
			`<meta name="twitter:image:alt" content="${twitter.imageAlt}">`
		);
	if (twitter.site)
		tags.push(`<meta name="twitter:site" content="${twitter.site}">`);
	if (twitter.creator)
		tags.push(`<meta name="twitter:creator" content="${twitter.creator}">`);

	return tags;
};

const renderMetaTag = (tag: {
	name?: string;
	property?: string;
	httpEquiv?: string;
	content: string;
}) => {
	if (tag.property)
		return `<meta property="${tag.property}" content="${tag.content}">`;
	if (tag.httpEquiv)
		return `<meta http-equiv="${tag.httpEquiv}" content="${tag.content}">`;
	if (tag.name) return `<meta name="${tag.name}" content="${tag.content}">`;

	return undefined;
};

export const generateHeadElement = ({
	cssPath,
	title = 'AbsoluteJS',
	description = 'A page created using AbsoluteJS',
	font,
	icon = '/assets/ico/favicon.ico',
	canonical,
	openGraph,
	twitter,
	robots,
	meta
}: Metadata = {}) => {
	const tags: string[] = [
		'<meta charset="UTF-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
		`<title>${title}</title>`,
		`<meta name="description" content="${description}">`,
		`<link rel="icon" href="${icon}" type="image/x-icon">`
	];

	if (canonical) {
		tags.push(`<link rel="canonical" href="${canonical}">`);
	}

	tags.push(...renderOpenGraphTags(openGraph, title, description));
	tags.push(...renderTwitterTags(twitter, title, description));

	const robotsContent = robots ? renderRobotsContent(robots) : '';

	if (robotsContent) {
		tags.push(`<meta name="robots" content="${robotsContent}">`);
	}

	const renderedMeta = (meta ?? [])
		.map(renderMetaTag)
		.filter((tag): tag is string => tag !== undefined);

	tags.push(...renderedMeta);

	if (font) {
		tags.push(
			`<link rel="preconnect" href="https://fonts.googleapis.com">`,
			`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
			`<link href="https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap" rel="stylesheet">`
		);
	}

	const cssPaths = cssPath ? [cssPath].flat() : [];

	for (const path of cssPaths) {
		tags.push(`<link rel="stylesheet" href="${path}" type="text/css">`);
	}

	return `<head>\n  ${tags.join('\n  ')}\n</head>` as const;
};
