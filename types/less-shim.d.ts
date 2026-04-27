declare module 'less' {
	export type RenderOptions = {
		filename?: string;
		paths?: string[];
		plugins?: unknown[];
	};

	export type RenderOutput = {
		css: string;
	};

	export function render(
		source: string,
		options?: RenderOptions
	): Promise<RenderOutput>;

	const less: {
		render: typeof render;
	};

	export = less;
}

declare module 'stylus' {
	type StylusRenderer = {
		include(path: string): StylusRenderer;
		render(callback: (error: Error | null, css?: string) => void): void;
		set(key: string, value: unknown): StylusRenderer;
	};

	type StylusFactory = {
		(source: string): StylusRenderer;
	};

	const stylus: StylusFactory;
	export = stylus;
}
