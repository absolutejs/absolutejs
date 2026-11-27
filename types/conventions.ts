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

/** The nearest `error` and `not-found` above a file route, in its route
 *  folder (build/routeFolderConventions.ts). */
export type RouteFolderConventions = {
	error?: string;
	notFound?: string;
};

/** A route folder's `not-found`, and the address the folder stands for
 *  (`/blog`, `/blog/:slug`): the 404 for an address under it that no
 *  route answers. */
export type FolderNotFound = {
	notFound: string;
	path: string;
};

export type FrameworkConventionEntry = {
	defaults?: FrameworkConventions;
	pages?: Record<string, PageConventions>;
	/** Route folders that have a `not-found`. */
	folders?: FolderNotFound[];
	/** File routes' folder conventions, by route page name. */
	routes?: Record<string, RouteFolderConventions>;
};

export type ConventionsMap = {
	react?: FrameworkConventionEntry;
	svelte?: FrameworkConventionEntry;
	vue?: FrameworkConventionEntry;
	angular?: FrameworkConventionEntry;
	ember?: FrameworkConventionEntry;
	html?: FrameworkConventionEntry;
	/** Conventions from the HTMX pages directory only. HTMX pages try these
	 *  first, then `html` (which also includes them). */
	htmx?: FrameworkConventionEntry;
};

// Serializable subset of `Error` — the runtime shape we hand to error-page
// renderers. Stripped to what's safe to render: no `cause` (unrenderable),
// no prototype chain. `stack` is omitted in production.
export type ErrorPageProps = Pick<Error, 'name' | 'message' | 'stack'>;

// Return type for function-style render helpers. Forces the leading
// `<!DOCTYPE html>` — TS contextually narrows template literals against
// this template literal type, so users don't need `as const` casts.
export type HtmlDocument =
	`<!DOCTYPE html>${string}` | `<!doctype html>${string}`;

export type RenderErrorPage = (error: ErrorPageProps) => HtmlDocument;
export type RenderNotFoundPage = () => HtmlDocument;
