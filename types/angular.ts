export type AngularDeps = {
	APP_BASE_HREF: typeof import('@angular/common').APP_BASE_HREF;
	bootstrapApplication: typeof import('@angular/platform-browser').bootstrapApplication;
	DomSanitizer: typeof import('@angular/platform-browser').DomSanitizer;
	provideClientHydration: typeof import('@angular/platform-browser').provideClientHydration;
	provideServerRendering: typeof import('@angular/platform-server').provideServerRendering;
	provideZonelessChangeDetection: typeof import('@angular/core').provideZonelessChangeDetection;
	renderApplication: typeof import('@angular/platform-server').renderApplication;
	Sanitizer: typeof import('@angular/core').Sanitizer;
	SecurityContext: typeof import('@angular/core').SecurityContext;
};

export type AngularPageFactory<
	Props extends Record<string, unknown> = Record<string, unknown>
> = (props: Props) => unknown;

export type AngularPageImporter<
	Props extends Record<string, unknown> = Record<string, unknown>
> = () => Promise<{ factory: AngularPageFactory<Props> }>;

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
