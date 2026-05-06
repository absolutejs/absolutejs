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
	ember?: FrameworkConventionEntry;
	html?: FrameworkConventionEntry;
};

// Serializable subset of `Error` — the runtime shape we hand to error-page
// renderers. Stripped to what's safe to render: no `cause` (unrenderable),
// no prototype chain. `stack` is omitted in production.
export type ErrorPageProps = Pick<Error, 'name' | 'message' | 'stack'>;

// Return type for function-style render helpers. Forces the leading
// `<!DOCTYPE html>` — TS contextually narrows template literals against
// this template literal type, so users don't need `as const` casts.
export type HtmlDocument =
	| `<!DOCTYPE html>${string}`
	| `<!doctype html>${string}`;

export type RenderErrorPage = (error: ErrorPageProps) => HtmlDocument;
export type RenderNotFoundPage = () => HtmlDocument;
