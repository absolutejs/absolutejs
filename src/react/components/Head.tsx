import type {
	Metadata,
	MetaTag,
	OpenGraph,
	TwitterCard,
	RobotsDirective
} from '../../../types/metadata';

const RobotsContent = ({ robots }: { robots: RobotsDirective }) => {
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

	const content = directives.join(', ');

	return content ? <meta content={content} name="robots" /> : null;
};

const OpenGraphTags = ({
	openGraph,
	title,
	description
}: {
	openGraph: OpenGraph;
	title: string;
	description: string;
}) => (
	<>
		<meta content={openGraph.title ?? title} property="og:title" />
		<meta
			content={openGraph.description ?? description}
			property="og:description"
		/>
		{openGraph.url && <meta content={openGraph.url} property="og:url" />}
		{openGraph.image && (
			<meta content={openGraph.image} property="og:image" />
		)}
		{openGraph.imageAlt && (
			<meta content={openGraph.imageAlt} property="og:image:alt" />
		)}
		{openGraph.imageWidth && (
			<meta
				content={String(openGraph.imageWidth)}
				property="og:image:width"
			/>
		)}
		{openGraph.imageHeight && (
			<meta
				content={String(openGraph.imageHeight)}
				property="og:image:height"
			/>
		)}
		{openGraph.type && <meta content={openGraph.type} property="og:type" />}
		{openGraph.siteName && (
			<meta content={openGraph.siteName} property="og:site_name" />
		)}
		{openGraph.locale && (
			<meta content={openGraph.locale} property="og:locale" />
		)}
	</>
);

const TwitterTags = ({
	twitter,
	title,
	description
}: {
	twitter: TwitterCard;
	title: string;
	description: string;
}) => (
	<>
		{twitter.card && <meta content={twitter.card} name="twitter:card" />}
		<meta content={twitter.title ?? title} name="twitter:title" />
		<meta
			content={twitter.description ?? description}
			name="twitter:description"
		/>
		{twitter.image && <meta content={twitter.image} name="twitter:image" />}
		{twitter.imageAlt && (
			<meta content={twitter.imageAlt} name="twitter:image:alt" />
		)}
		{twitter.site && <meta content={twitter.site} name="twitter:site" />}
		{twitter.creator && (
			<meta content={twitter.creator} name="twitter:creator" />
		)}
	</>
);

const CustomMetaTag = ({ tag }: { tag: MetaTag }) => {
	if (tag.property)
		return <meta content={tag.content} property={tag.property} />;

	if (tag.httpEquiv)
		return <meta content={tag.content} httpEquiv={tag.httpEquiv} />;

	return <meta content={tag.content} name={tag.name} />;
};

export const Head = ({
	title = 'AbsoluteJS',
	description = 'A page created using AbsoluteJS',
	icon = '/assets/ico/favicon.ico',
	font,
	cssPath,
	canonical,
	openGraph,
	twitter,
	robots,
	meta
}: Metadata = {}) => (
	<head suppressHydrationWarning>
		<meta charSet="utf-8" />
		<title>{title}</title>
		<meta content={description} name="description" />
		<meta content="width=device-width, initial-scale=1" name="viewport" />
		<link href={icon} rel="icon" />
		{canonical && <link href={canonical} rel="canonical" />}
		{openGraph && (
			<OpenGraphTags
				description={description}
				openGraph={openGraph}
				title={title}
			/>
		)}
		{twitter && (
			<TwitterTags
				description={description}
				title={title}
				twitter={twitter}
			/>
		)}
		{robots && <RobotsContent robots={robots} />}
		{meta?.map((tag, i) => <CustomMetaTag key={i} tag={tag} />)}
		{font && (
			<>
				<link href="https://fonts.googleapis.com" rel="preconnect" />
				<link
					crossOrigin="anonymous"
					href="https://fonts.gstatic.com"
					rel="preconnect"
					suppressHydrationWarning
				/>
				<link
					href={`https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap`}
					rel="stylesheet"
					suppressHydrationWarning
				/>
			</>
		)}
		{cssPath &&
			[cssPath]
				.flat()
				.map((path) => (
					<link
						href={path}
						key={path}
						rel="stylesheet"
						suppressHydrationWarning
						type="text/css"
					/>
				))}
	</head>
);
