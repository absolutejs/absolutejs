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
	httpEquiv?: string;
	content: string;
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
};
