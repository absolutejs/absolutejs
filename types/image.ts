export type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'png';

export type RemotePattern = {
	protocol?: 'http' | 'https';
	hostname: string;
	port?: string;
	pathname?: string;
};

export type ImageLoaderParams = {
	src: string;
	width: number;
	quality: number;
};

export type ImageLoader = (params: ImageLoaderParams) => string;

export type ImageConfig = {
	/** Breakpoints for device-width responsive images (default: [640, 750, 828, 1080, 1200, 1920, 2048, 3840]) */
	deviceSizes?: number[];
	/** Breakpoints for fixed-width images (default: [16, 32, 48, 64, 96, 128, 256, 384]) */
	imageSizes?: number[];
	/** Output formats in preference order (default: ['webp']). Add 'avif' for smaller files at slower encode. */
	formats?: ImageFormat[];
	/** Minimum cache TTL in seconds (default: 60) */
	minimumCacheTTL?: number;
	/** Allowed remote image origins */
	remotePatterns?: RemotePattern[];
	/** Default quality 1-100 (default: 75) */
	quality?: number;
	/** Custom URL builder — overrides the default optimization endpoint */
	loader?: ImageLoader;
	/** Optimization endpoint path (default: '/_absolute/image') */
	path?: string;
	/** Globally disable image optimization — serve images as-is */
	unoptimized?: boolean;
};

export type ImageProps = {
	/** Image source URL or path */
	src: string;
	/** Alt text for accessibility (required) */
	alt: string;
	/** Intrinsic width in pixels (required unless fill) */
	width?: number;
	/** Intrinsic height in pixels (required unless fill) */
	height?: number;
	/** Fill parent container with position: absolute */
	fill?: boolean;
	/** Quality 1-100 (default: 75) */
	quality?: number;
	/** Responsive sizes attribute (e.g., "(max-width: 768px) 100vw, 50vw") */
	sizes?: string;
	/** Custom URL builder for this image */
	loader?: ImageLoader;
	/** Bypass optimization for this image */
	unoptimized?: boolean;
	/** Loading strategy (default: "lazy") */
	loading?: 'lazy' | 'eager';
	/** Add <link rel="preload"> and set loading="eager" + fetchPriority="high" */
	priority?: boolean;
	/** Placeholder while loading: "blur" uses blurDataURL, "empty" shows nothing, or pass a data URI */
	placeholder?: 'blur' | 'empty' | string;
	/** Base64 blur placeholder data URI (auto-generated for build-time images) */
	blurDataURL?: string;
	/** CSS class name */
	className?: string;
	/** Inline styles */
	style?: Record<string, string | number>;
	/** Callback when image loads */
	onLoad?: (() => void) | ((event: Event) => void);
	/** Callback on load error */
	onError?: (() => void) | ((event: Event) => void);
	/** CORS setting */
	crossOrigin?: 'anonymous' | 'use-credentials' | '';
	/** Referrer policy */
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
	/** Fetch priority hint */
	fetchPriority?: 'high' | 'low' | 'auto';
	/** Override the final src attribute on the rendered <img> */
	overrideSrc?: string;
};
