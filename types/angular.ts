export type AngularDeps = {
	APP_BASE_HREF: typeof import('@angular/common').APP_BASE_HREF;
	bootstrapApplication: typeof import('@angular/platform-browser').bootstrapApplication;
	DomSanitizer: typeof import('@angular/platform-browser').DomSanitizer;
	ENVIRONMENT_INITIALIZER: typeof import('@angular/core').ENVIRONMENT_INITIALIZER;
	inject: typeof import('@angular/core').inject;
	provideClientHydration: typeof import('@angular/platform-browser').provideClientHydration;
	provideServerRendering: typeof import('@angular/platform-server').provideServerRendering;
	provideZonelessChangeDetection: typeof import('@angular/core').provideZonelessChangeDetection;
	reflectComponentType: typeof import('@angular/core').reflectComponentType;
	renderApplication: typeof import('@angular/platform-server').renderApplication;
	REQUEST: typeof import('@angular/core').REQUEST;
	REQUEST_CONTEXT: typeof import('@angular/core').REQUEST_CONTEXT;
	RESPONSE_INIT: typeof import('@angular/core').RESPONSE_INIT;
	Sanitizer: typeof import('@angular/core').Sanitizer;
	SecurityContext: typeof import('@angular/core').SecurityContext;
	withHttpTransferCacheOptions: typeof import('@angular/platform-browser').withHttpTransferCacheOptions;
};

/**
 * Cached render data per route. The `headTag` is captured once when
 * the page module is registered so subsequent renders skip the
 * filesystem read. The `requestContext` is the per-request payload
 * the backend handler passed under `requestContext`, kept for HMR
 * replay.
 */
export type CachedRouteData = {
	requestContext: unknown;
	headTag: `<head>${string}</head>`;
};

/**
 * One entry in the build-emitted route-mounts map. The SSR handler
 * tests each request URL against `pattern` and uses the matching
 * `basePath` as `APP_BASE_HREF` so sub-router pages (mounted at
 * `/portal/*`, `/admin/*`, etc.) get the right router base without
 * the page explicitly overriding it.
 */
export type AngularRouteMount = {
	pattern: RegExp;
	basePath: string;
};
