import { ComponentType as ReactComponent } from 'react';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent } from 'vue';

export type BuildOptions = {
	preserveIntermediateFiles?: boolean;
	/** When true, build() throws on error instead of exit(1) - used by HMR rebuilds */
	throwOnError?: boolean;
	hmr?: {
		debounceMs?: number;
	};
};

export type BuildConfig = {
	buildDirectory?: string;
	assetsDirectory?: string;
	reactDirectory?: string;
	vueDirectory?: string;
	angularDirectory?: string;
	astroDirectory?: string;
	svelteDirectory?: string;
	htmlDirectory?: string;
	htmxDirectory?: string;
	tailwind?: {
		input: string;
		output: string;
	};
	options?: BuildOptions;
	// Optional: List of files to rebuild incrementally (absolute paths)
	// When provided, only these files and their dependencies will be rebuilt
	incrementalFiles?: string[];
	// Optional: Host configuration for dev server
	// Default: environment variable (HOST) or 'localhost'
	host?: string;
	// Optional: Port configuration for dev server
	// Default: environment variable (PORT) or 3000
	port?: number;
};

export type PropsOf<Component> =
	Component extends ReactComponent<infer Props>
		? Props
		: Component extends SvelteComponent<infer Props>
			? Props
			: Component extends VueComponent<infer Props>
				? Props
				: Record<string, never>;

export type PropsArgs<C> = keyof PropsOf<C> extends never ? [] : [PropsOf<C>];

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type BuildResult = {
	buildDir: string;
	manifest: Record<string, string>;
};
