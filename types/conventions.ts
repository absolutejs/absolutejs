export type ConventionKind = 'error' | 'loading' | 'not-found';

export type PageConventions = {
	error?: string;
	loading?: string;
};

export type FrameworkConventions = {
	error?: string;
	loading?: string;
	notFound?: string;
};

export type FrameworkConventionEntry = {
	defaults?: FrameworkConventions;
	pages?: Record<string, PageConventions>;
};

export type ConventionsMap = {
	react?: FrameworkConventionEntry;
	svelte?: FrameworkConventionEntry;
	vue?: FrameworkConventionEntry;
	angular?: FrameworkConventionEntry;
};
