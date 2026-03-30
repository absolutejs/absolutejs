<script setup lang="ts">
import { computed, ref } from 'vue';
import { DEFAULT_QUALITY, buildOptimizedUrl, generateBlurSvg, generateSrcSet } from '@absolutejs/absolute/image';

type ImageLoader = (params: {
	src: string;
	width: number;
	quality: number;
}) => string;

const props = withDefaults(
	defineProps<{
		src: string;
		alt: string;
		width?: number;
		height?: number;
		fill?: boolean;
		quality?: number;
		sizes?: string;
		loader?: ImageLoader;
		unoptimized?: boolean;
		loading?: 'lazy' | 'eager';
		priority?: boolean;
		placeholder?: 'blur' | 'empty' | string;
		blurDataURL?: string;
		className?: string;
		style?: Record<string, string | number>;
		onLoad?: (() => void) | ((event: Event) => void);
		onError?: (() => void) | ((event: Event) => void);
		crossOrigin?: 'anonymous' | 'use-credentials' | '';
		referrerPolicy?:
			| ''
			| 'no-referrer'
			| 'no-referrer-when-downgrade'
			| 'origin'
			| 'origin-when-cross-origin'
			| 'same-origin'
			| 'strict-origin'
			| 'strict-origin-when-cross-origin'
			| 'unsafe-url';
		fetchPriority?: 'high' | 'low' | 'auto';
		overrideSrc?: string;
	}>(),
	{
		quality: DEFAULT_QUALITY,
		loading: 'lazy'
	}
);

const blurRemoved = ref(false);

const resolvedSrc = computed(() => {
	if (props.overrideSrc) return props.overrideSrc;
	if (props.unoptimized) return props.src;
	if (props.loader)
		return props.loader({
			src: props.src,
			width: props.width ?? 0,
			quality: props.quality
		});
	if (!props.width) return buildOptimizedUrl(props.src, 0, props.quality);
	return buildOptimizedUrl(props.src, props.width, props.quality);
});

const srcSet = computed(() =>
	props.unoptimized
		? undefined
		: generateSrcSet(props.src, props.width, props.sizes)
);

const resolvedSizes = computed(
	() => props.sizes ?? (props.fill ? '100vw' : undefined)
);

const resolvedLoading = computed(() =>
	props.priority ? 'eager' : props.loading
);

const resolvedFetchPriority = computed(() =>
	props.priority ? 'high' : props.fetchPriority
);

const hasBlur = computed(
	() =>
		props.placeholder === 'blur' ||
		(typeof props.placeholder === 'string' &&
			props.placeholder !== 'empty' &&
			props.placeholder.startsWith('data:'))
);

const blurBackground = computed(() => {
	if (!hasBlur.value || blurRemoved.value) return undefined;
	if (
		typeof props.placeholder === 'string' &&
		props.placeholder !== 'blur' &&
		props.placeholder.startsWith('data:')
	) {
		return generateBlurSvg(props.placeholder);
	}
	if (props.blurDataURL) return generateBlurSvg(props.blurDataURL);
	return undefined;
});

const imgStyle = computed(() => {
	const base: Record<string, string | number> = {
		...(props.style ?? {}),
		color: 'transparent'
	};
	if (blurBackground.value) {
		base.backgroundImage = blurBackground.value;
		base.backgroundSize = 'cover';
		base.backgroundPosition = 'center';
		base.backgroundRepeat = 'no-repeat';
	}
	if (props.fill) {
		base.position = 'absolute';
		base.height = '100%';
		base.width = '100%';
		base.inset = '0';
		base.objectFit = 'cover';
	}
	return base;
});

const handleLoad = (e: Event) => {
	blurRemoved.value = true;
	if (props.onLoad) (props.onLoad as (event: Event) => void)(e);
};

const handleError = (e: Event) => {
	if (props.onError) (props.onError as (event: Event) => void)(e);
};
</script>

<template>
	<span
		v-if="fill"
		style="
			position: relative;
			overflow: hidden;
			display: block;
			width: 100%;
			height: 100%;
		"
	>
		<img
			:alt="alt"
			:src="resolvedSrc"
			:srcset="srcSet"
			:sizes="resolvedSizes"
			:loading="resolvedLoading"
			:class="className"
			:style="imgStyle"
			:crossorigin="crossOrigin"
			:referrerpolicy="referrerPolicy"
			:fetchpriority="resolvedFetchPriority"
			decoding="async"
			@load="handleLoad"
			@error="handleError"
		/>
	</span>

	<img
		v-else
		:alt="alt"
		:src="resolvedSrc"
		:srcset="srcSet"
		:sizes="resolvedSizes"
		:width="width"
		:height="height"
		:loading="resolvedLoading"
		:class="className"
		:style="imgStyle"
		:crossorigin="crossOrigin"
		:referrerpolicy="referrerPolicy"
		:fetchpriority="resolvedFetchPriority"
		decoding="async"
		@load="handleLoad"
		@error="handleError"
	/>
</template>
