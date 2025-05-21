export type HTMLScriptOption = "ts" | "js" | "ts+ssr" | "js+ssr" | undefined;

export type BuildConfig = {
	buildDirectory?: string;
	assetsDirectory?: string;
	reactDirectory?: string;
	vueDirectory?: string;
	angularDirectory?: string;
	astroDirectory?: string;
	svelteDirectory?: string;
	html?: {
		directory?: string;
		scriptingOption: HTMLScriptOption;
	};
	htmxDirectory?: string;
	tailwind?: {
		input: string;
		output: string;
	};
};
