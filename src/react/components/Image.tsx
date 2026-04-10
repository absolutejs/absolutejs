import type { ImageProps } from '../../../types/image';
import {
	DEFAULT_QUALITY,
	buildOptimizedUrl,
	generateBlurSvg,
	generateSrcSet
} from '../../utils/imageClient';

const resolveSource = (
	src: string,
	overrideSrc: ImageProps['overrideSrc'],
	unoptimized: ImageProps['unoptimized'],
	loader: ImageProps['loader'],
	width: ImageProps['width'],
	quality: number
) => {
	if (overrideSrc) return overrideSrc;
	if (unoptimized) return src;
	if (loader) return loader({ quality, src, width: width ?? 0 });
	if (!width) return buildOptimizedUrl(src, 0, quality);

	return buildOptimizedUrl(src, width, quality);
};

const resolveBlurBackground = (
	hasBlur: boolean,
	placeholder: ImageProps['placeholder'],
	blurDataURL: ImageProps['blurDataURL']
) => {
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
};

export const Image = ({
	alt,
	blurDataURL,
	className,
	crossOrigin,
	fetchPriority,
	fill,
	height,
	loader,
	loading,
	onError,
	onLoad,
	overrideSrc,
	placeholder,
	priority,
	quality = DEFAULT_QUALITY,
	referrerPolicy,
	sizes,
	src,
	style,
	unoptimized,
	width
}: ImageProps) => {
	// ── Resolve src ─────────────────────────────────────────────
	const resolvedSrc = resolveSource(
		src,
		overrideSrc,
		unoptimized,
		loader,
		width,
		quality
	);

	// ── srcSet ──────────────────────────────────────────────────
	const srcSet = unoptimized ? undefined : generateSrcSet(src, width, sizes);

	// ── Sizes ───────────────────────────────────────────────────
	const resolvedSizes = sizes ?? (fill ? '100vw' : undefined);

	// ── Loading behavior ────────────────────────────────────────
	const resolvedLoading = priority ? 'eager' : (loading ?? 'lazy');
	const resolvedFetchPriority = priority ? 'high' : fetchPriority;

	// ── Blur placeholder ────────────────────────────────────────
	const hasBlur =
		placeholder === 'blur' ||
		(typeof placeholder === 'string' &&
			placeholder !== 'empty' &&
			placeholder.startsWith('data:'));

	const blurBackground = resolveBlurBackground(
		hasBlur,
		placeholder,
		blurDataURL
	);

	// ── Styles ──────────────────────────────────────────────────
	const imgStyle: Record<string, string | number> = {
		...(style ?? {}),
		...(blurBackground
			? {
					backgroundImage: blurBackground,
					backgroundPosition: 'center',
					backgroundRepeat: 'no-repeat',
					backgroundSize: 'cover'
				}
			: {}),
		...(fill
			? {
					color: 'transparent',
					height: '100%',
					inset: 0,
					objectFit: 'cover',
					position: 'absolute',
					width: '100%'
				}
			: { color: 'transparent' })
	};

	// ── Preload link for priority images ────────────────────────
	const preloadLink = priority ? (
		<link
			as="image"
			crossOrigin={crossOrigin}
			href={resolvedSrc}
			imageSizes={resolvedSizes}
			imageSrcSet={srcSet}
			rel="preload"
		/>
	) : null;

	// ── Fill mode wrapper ───────────────────────────────────────
	const imgElement = (
		<img
			alt={alt}
			className={className}
			crossOrigin={crossOrigin}
			decoding="async"
			fetchPriority={resolvedFetchPriority}
			height={fill ? undefined : height}
			loading={resolvedLoading}
			onError={
				onError ? (event) => onError(event.nativeEvent) : undefined
			}
			onLoad={(event) => {
				const { target } = event;

				if (blurBackground && target instanceof HTMLImageElement) {
					target.style.backgroundImage = 'none';
				}

				if (onLoad) onLoad(event.nativeEvent);
			}}
			referrerPolicy={referrerPolicy}
			sizes={resolvedSizes}
			src={resolvedSrc}
			srcSet={srcSet}
			style={imgStyle}
			width={fill ? undefined : width}
		/>
	);

	if (fill) {
		return (
			<>
				{preloadLink}
				<span
					style={{
						display: 'block',
						height: '100%',
						overflow: 'hidden',
						position: 'relative',
						width: '100%'
					}}
				>
					{imgElement}
				</span>
			</>
		);
	}

	return (
		<>
			{preloadLink}
			{imgElement}
		</>
	);
};
