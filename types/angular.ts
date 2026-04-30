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

export type AngularPageDefinition<
	Props extends Record<string, unknown> = Record<never, never>
> = {
	component: import('@angular/core').Type<unknown>;
	/** Type-only marker used by handleAngularPageRequest to infer route props. */
	__absoluteAngularPageProps?: Props;
};

export type AngularPagePropsOf<Page> = Page extends {
	page: AngularPageDefinition<infer Props>;
}
	? Props
	: Page extends { default: AngularPageDefinition<infer Props> }
		? Props
		: Record<never, never>;

export type CachedRouteData = {
	props: Record<string, unknown> | undefined;
	headTag: `<head>${string}</head>`;
};

export type SsrDepsResult = {
	common: typeof import('@angular/common');
	core: typeof import('@angular/core');
	platformBrowser: typeof import('@angular/platform-browser');
	platformServer: typeof import('@angular/platform-server');
};
