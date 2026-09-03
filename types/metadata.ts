export type OpenGraph = {
	title?: string;
	description?: string;
	url?: string;
	image?: string;
	imageAlt?: string;
	imageWidth?: number;
	imageHeight?: number;
	type?: 'website' | 'article' | 'profile' | (string & {});
	siteName?: string;
	locale?: string;
};

export type TwitterCard = {
	card?: 'summary' | 'summary_large_image' | 'player' | 'app';
	title?: string;
	description?: string;
	image?: string;
	imageAlt?: string;
	site?: string;
	creator?: string;
};

export type RobotsDirective = {
	index?: boolean;
	follow?: boolean;
	noarchive?: boolean;
	nosnippet?: boolean;
	noimageindex?: boolean;
	maxSnippet?: number;
	maxImagePreview?: 'none' | 'standard' | 'large';
	maxVideoPreview?: number;
};

export type MetaTag = {
	name?: string;
	property?: string;
	httpEquiv?:
		| 'accept-ch'
		| 'content-security-policy'
		| 'content-type'
		| 'default-style'
		| 'refresh'
		| 'x-ua-compatible';
	content: string;
};

import type { JsonLdSchema } from './jsonLd';

/** A `<link rel="preload">` (or `rel="modulepreload"` when `module` is
 *  set) emitted in the document head so the browser starts fetching the
 *  resource before the parser discovers it. */
export type PreloadLink = {
	href: string;
	/** Resource type hint. Ignored for `module` preloads. */
	as?: 'script' | 'style' | 'fetch' | 'image' | 'font';
	/** Emit `<link rel="modulepreload">` instead of `<link rel="preload">`. */
	module?: boolean;
	/** `crossorigin` attribute value — required for fonts and any
	 *  credentialed fetch so the preload matches the real request. */
	crossorigin?: string;
};

/** Declarative speculation rules rendered as
 *  `<script type="speculationrules">`. URLs are same-origin page paths;
 *  `prerender` targets render fully in a hidden tab, `prefetch` targets
 *  are fetched but not rendered. */
export type SpeculationRules = {
	prerender?: string[];
	prefetch?: string[];
};

export type Metadata = {
	title?: string;
	description?: string;
	icon?: string;
	font?: string;
	cssPath?: string | string[];
	canonical?: string;
	openGraph?: OpenGraph;
	twitter?: TwitterCard;
	robots?: RobotsDirective;
	meta?: MetaTag[];
	jsonLd?: JsonLdSchema | JsonLdSchema[];
	preload?: PreloadLink[];
	speculationRules?: SpeculationRules;
};
