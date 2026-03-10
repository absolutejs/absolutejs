export type AngularDeps = {
	bootstrapApplication: any;
	DomSanitizer: any;
	provideClientHydration: any;
	renderApplication: any;
	provideServerRendering: any;
	APP_BASE_HREF: any;
	provideZonelessChangeDetection: any;
	Sanitizer: any;
	SecurityContext: any;
	domino: {
		createWindow?: (html: string, url: string) => { document: Document };
	} | null;
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
	common: any;
	core: any;
	platformBrowser: any;
	platformServer: any;
};
