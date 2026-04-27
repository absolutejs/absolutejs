import { computed, defineComponent, h, ref } from 'vue';
import {
	DEFAULT_QUALITY,
	buildOptimizedUrl,
	generateBlurSvg,
	generateSrcSet
} from '../../utils/imageClient';

type ImageLoader = (params: {
	src: string;
	width: number;
	quality: number;
}) => string;

type ImageStyle = Record<string, string | number>;

type ImageProps = {
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
	placeholder?: string;
	blurDataURL?: string;
	className?: string;
	style?: ImageStyle;
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
};

const fillWrapperStyle: ImageStyle = {
	display: 'block',
	height: '100%',
	overflow: 'hidden',
	position: 'relative',
	width: '100%'
};

export default defineComponent({
	name: 'AbsoluteImage',
	props: {
		src: { required: true, type: String },
		alt: { required: true, type: String },
		width: { default: undefined, type: Number },
		height: { default: undefined, type: Number },
		fill: { default: false, type: Boolean },
		quality: { default: DEFAULT_QUALITY, type: Number },
		sizes: { default: undefined, type: String },
		loader: { default: undefined, type: Function },
		unoptimized: { default: false, type: Boolean },
		loading: { default: 'lazy', type: String },
		priority: { default: false, type: Boolean },
		placeholder: { default: undefined, type: String },
		blurDataURL: { default: undefined, type: String },
		className: { default: undefined, type: String },
		style: { default: undefined, type: Object },
		onLoad: { default: undefined, type: Function },
		onError: { default: undefined, type: Function },
		crossOrigin: { default: undefined, type: String },
		referrerPolicy: { default: undefined, type: String },
		fetchPriority: { default: undefined, type: String },
		overrideSrc: { default: undefined, type: String }
	},
	setup(props: ImageProps) {
		const blurRemoved = ref(false);

		const resolvedSrc = computed(() => {
			if (props.overrideSrc) return props.overrideSrc;
			if (props.unoptimized) return props.src;
			if (props.loader) {
				return props.loader({
					quality: props.quality ?? DEFAULT_QUALITY,
					src: props.src,
					width: props.width ?? 0
				});
			}
			if (!props.width) {
				return buildOptimizedUrl(
					props.src,
					0,
					props.quality ?? DEFAULT_QUALITY
				);
			}

			return buildOptimizedUrl(
				props.src,
				props.width,
				props.quality ?? DEFAULT_QUALITY
			);
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
			props.priority ? 'eager' : (props.loading ?? 'lazy')
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
			const base: ImageStyle = {
				...(props.style ?? {}),
				color: 'transparent'
			};
			if (blurBackground.value) {
				base.backgroundImage = blurBackground.value;
				base.backgroundPosition = 'center';
				base.backgroundRepeat = 'no-repeat';
				base.backgroundSize = 'cover';
			}
			if (props.fill) {
				base.height = '100%';
				base.inset = '0';
				base.objectFit = 'cover';
				base.position = 'absolute';
				base.width = '100%';
			}

			return base;
		});

		const handleLoad = (event: Event) => {
			blurRemoved.value = true;
			props.onLoad?.(event);
		};

		const handleError = (event: Event) => {
			props.onError?.(event);
		};

		return () => {
			const imgNode = h('img', {
				alt: props.alt,
				class: props.className,
				crossorigin: props.crossOrigin,
				decoding: 'async',
				fetchpriority: resolvedFetchPriority.value,
				height: props.fill ? undefined : props.height,
				loading: resolvedLoading.value,
				onError: handleError,
				onLoad: handleLoad,
				referrerpolicy: props.referrerPolicy,
				sizes: resolvedSizes.value,
				src: resolvedSrc.value,
				srcset: srcSet.value,
				style: imgStyle.value,
				width: props.fill ? undefined : props.width
			});

			return props.fill
				? h('span', { style: fillWrapperStyle }, [imgNode])
				: imgNode;
		};
	}
});
