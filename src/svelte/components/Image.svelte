<script lang="ts">
	import type { ImageProps } from '@absolutejs/absolute/image';
	import { DEFAULT_QUALITY, buildOptimizedUrl, generateBlurSvg, generateSrcSet } from '@absolutejs/absolute/image';

	let {
		src,
		alt,
		width,
		height,
		fill,
		quality = DEFAULT_QUALITY,
		sizes,
		loader,
		unoptimized,
		loading,
		priority,
		placeholder,
		blurDataURL,
		className,
		style,
		onLoad,
		onError,
		crossOrigin,
		referrerPolicy,
		fetchPriority,
		overrideSrc
	}: ImageProps = $props();

	const resolvedSrc = $derived.by(() => {
		if (overrideSrc) return overrideSrc;
		if (unoptimized) return src;
		if (loader) return loader({ src, width: width ?? 0, quality });
		if (!width) return buildOptimizedUrl(src, 0, quality);
		return buildOptimizedUrl(src, width, quality);
	});

	const srcSet = $derived(
		unoptimized ? undefined : generateSrcSet(src, width, sizes)
	);

	const resolvedSizes = $derived(sizes ?? (fill ? '100vw' : undefined));

	const resolvedLoading = $derived(priority ? 'eager' : (loading ?? 'lazy'));

	const resolvedFetchPriority = $derived(priority ? 'high' : fetchPriority);

	const hasBlur = $derived(
		placeholder === 'blur' ||
			(typeof placeholder === 'string' &&
				placeholder !== 'empty' &&
				placeholder.startsWith('data:'))
	);

	const blurBackground = $derived.by(() => {
		if (!hasBlur) return undefined;
		if (
			typeof placeholder === 'string' &&
			placeholder !== 'blur' &&
			placeholder.startsWith('data:')
		) {
			return generateBlurSvg(placeholder);
		}
		if (blurDataURL) return generateBlurSvg(blurDataURL);
		return undefined;
	});

	const imgStyle = $derived.by(() => {
		const base: Record<string, string | number> = {
			...(style ?? {}),
			color: 'transparent'
		};
		if (blurBackground) {
			base.backgroundImage = blurBackground;
			base.backgroundSize = 'cover';
			base.backgroundPosition = 'center';
			base.backgroundRepeat = 'no-repeat';
		}
		if (fill) {
			base.position = 'absolute';
			base.height = '100%';
			base.width = '100%';
			base.inset = 0;
			base.objectFit = 'cover';
		}
		return Object.entries(base)
			.map(
				([k, v]) =>
					`${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`
			)
			.join(';');
	});

	const handleLoad = (e: Event) => {
		if (blurBackground) {
			(e.target as HTMLImageElement).style.backgroundImage = 'none';
		}
		if (onLoad) (onLoad as (event: Event) => void)(e);
	};

	const handleError = (e: Event) => {
		if (onError) (onError as (event: Event) => void)(e);
	};
</script>

<svelte:head>
	{#if priority}
		<link
			rel="preload"
			as="image"
			href={resolvedSrc}
			imagesrcset={srcSet}
			imagesizes={resolvedSizes}
			crossorigin={crossOrigin}
		/>
	{/if}
</svelte:head>

{#if fill}
	<span
		style="position:relative;overflow:hidden;display:block;width:100%;height:100%"
	>
		<img
			{alt}
			src={resolvedSrc}
			srcset={srcSet}
			sizes={resolvedSizes}
			loading={resolvedLoading}
			class={className}
			style={imgStyle}
			crossorigin={crossOrigin}
			referrerpolicy={referrerPolicy}
			fetchpriority={resolvedFetchPriority}
			decoding="async"
			onload={handleLoad}
			onerror={handleError}
		/>
	</span>
{:else}
	<img
		{alt}
		src={resolvedSrc}
		srcset={srcSet}
		sizes={resolvedSizes}
		{width}
		{height}
		loading={resolvedLoading}
		class={className}
		style={imgStyle}
		crossorigin={crossOrigin}
		referrerpolicy={referrerPolicy}
		fetchpriority={resolvedFetchPriority}
		decoding="async"
		onload={handleLoad}
		onerror={handleError}
	/>
{/if}
