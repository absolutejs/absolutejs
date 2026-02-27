export type AngularPageFactory<
	Props extends Record<string, unknown> = Record<string, unknown>
> = (props: Props) => unknown;

export type AngularPageImporter<
	Props extends Record<string, unknown> = Record<string, unknown>
> = () => Promise<{ factory: AngularPageFactory<Props> }>;
