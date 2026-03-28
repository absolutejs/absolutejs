<script lang="ts">
	import type { Metadata, RobotsDirective } from '../../../types/metadata';

	let {
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
	}: Metadata = $props();

	const robotsContent = (r: RobotsDirective) => {
		const directives: string[] = [];
		if (r.index === false) directives.push('noindex');
		if (r.index === true) directives.push('index');
		if (r.follow === false) directives.push('nofollow');
		if (r.follow === true) directives.push('follow');
		if (r.noarchive) directives.push('noarchive');
		if (r.nosnippet) directives.push('nosnippet');
		if (r.noimageindex) directives.push('noimageindex');
		if (r.maxSnippet !== undefined)
			directives.push(`max-snippet:${r.maxSnippet}`);
		if (r.maxImagePreview)
			directives.push(`max-image-preview:${r.maxImagePreview}`);
		if (r.maxVideoPreview !== undefined)
			directives.push(`max-video-preview:${r.maxVideoPreview}`);
		return directives.join(', ');
	};

	const cssPaths = $derived(
		cssPath ? (Array.isArray(cssPath) ? cssPath : [cssPath]) : []
	);
</script>

<svelte:head>
	<meta charset="utf-8" />
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="icon" href={icon} />

	{#if canonical}
		<link rel="canonical" href={canonical} />
	{/if}

	{#if openGraph}
		<meta property="og:title" content={openGraph.title ?? title} />
		<meta
			property="og:description"
			content={openGraph.description ?? description}
		/>
		{#if openGraph.url}
			<meta property="og:url" content={openGraph.url} />
		{/if}
		{#if openGraph.image}
			<meta property="og:image" content={openGraph.image} />
		{/if}
		{#if openGraph.imageAlt}
			<meta property="og:image:alt" content={openGraph.imageAlt} />
		{/if}
		{#if openGraph.imageWidth}
			<meta
				property="og:image:width"
				content={String(openGraph.imageWidth)}
			/>
		{/if}
		{#if openGraph.imageHeight}
			<meta
				property="og:image:height"
				content={String(openGraph.imageHeight)}
			/>
		{/if}
		{#if openGraph.type}
			<meta property="og:type" content={openGraph.type} />
		{/if}
		{#if openGraph.siteName}
			<meta property="og:site_name" content={openGraph.siteName} />
		{/if}
		{#if openGraph.locale}
			<meta property="og:locale" content={openGraph.locale} />
		{/if}
	{/if}

	{#if twitter}
		{#if twitter.card}
			<meta name="twitter:card" content={twitter.card} />
		{/if}
		<meta name="twitter:title" content={twitter.title ?? title} />
		<meta
			name="twitter:description"
			content={twitter.description ?? description}
		/>
		{#if twitter.image}
			<meta name="twitter:image" content={twitter.image} />
		{/if}
		{#if twitter.imageAlt}
			<meta name="twitter:image:alt" content={twitter.imageAlt} />
		{/if}
		{#if twitter.site}
			<meta name="twitter:site" content={twitter.site} />
		{/if}
		{#if twitter.creator}
			<meta name="twitter:creator" content={twitter.creator} />
		{/if}
	{/if}

	{#if robots}
		{@const content = robotsContent(robots)}
		{#if content}
			<meta name="robots" {content} />
		{/if}
	{/if}

	{#if meta}
		{#each meta as tag}
			{#if tag.property}
				<meta property={tag.property} content={tag.content} />
			{:else if tag.httpEquiv}
				<meta http-equiv={tag.httpEquiv} content={tag.content} />
			{:else if tag.name}
				<meta name={tag.name} content={tag.content} />
			{/if}
		{/each}
	{/if}

	{#if font}
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link
			rel="preconnect"
			href="https://fonts.gstatic.com"
			crossOrigin="anonymous"
		/>
		<link
			href={`https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap`}
			rel="stylesheet"
		/>
	{/if}

	{#each cssPaths as path}
		<link rel="stylesheet" href={path} type="text/css" />
	{/each}
</svelte:head>
