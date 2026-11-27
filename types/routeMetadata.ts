import type { AlternateLink } from './i18n';
import type { JsonLdSchema } from './jsonLd';
import type {
	MetaTag,
	OpenGraph,
	RobotsDirective,
	TwitterCard
} from './metadata';

/* A file route's metadata: `export const metadata` in the route's server
 * module, and in the `layout.server` modules of the folders above it
 * (src/utils/routeMetadata.ts). */

/** A title, or how titles below this folder are formed. */
export type RouteTitle =
	| string
	| {
			/** This exact title, with no template applied. */
			absolute?: string;
			/** The title for a route below that sets none. */
			default?: string;
			/** Applied to the title of every route below: `%s` is
			 *  replaced by it. `'%s | Acme'` makes `About` into
			 *  `About | Acme`. */
			template?: string;
	  };

/** What a route says about its page, for the document's `<head>`. */
export type RouteMetadata = {
	alternates?: AlternateLink[];
	canonical?: string;
	description?: string;
	jsonLd?: JsonLdSchema | JsonLdSchema[];
	meta?: MetaTag[];
	openGraph?: OpenGraph;
	robots?: RobotsDirective;
	title?: RouteTitle;
	twitter?: TwitterCard;
};

/** What a `metadata` function is given: the request, as `load` sees it,
 *  and what `load` returned. */
export type RouteMetadataContext<Data = Record<string, unknown>> = {
	data: Data;
	params: Record<string, string | undefined>;
	request: Request;
};

/** A module's `metadata` export: the metadata, or a function of the
 *  request and the page's data that returns it. */
export type RouteMetadataExport<Data = Record<string, unknown>> =
	| RouteMetadata
	| ((
			context: RouteMetadataContext<Data>
	  ) => RouteMetadata | Promise<RouteMetadata>);

/** A module's `markdown` export: the page as Markdown, or a function
 *  of the request and the page's data that returns it. */
export type RouteMarkdownExport<Data = Record<string, unknown>> =
	| string
	| ((context: RouteMetadataContext<Data>) => string | Promise<string>);
