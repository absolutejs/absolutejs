import { ComponentType as ReactComponent } from 'react';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent } from 'vue';

export type BuildOptions = {
	preserveIntermediateFiles?: boolean;
	/** When true, build() throws on error instead of exit(1) - used by HMR rebuilds */
	throwOnError?: boolean;
	/** When true, HMR client code is injected into built assets. Set by devBuild(). */
	injectHMR?: boolean;
	hmr?: {
		debounceMs?: number;
	};
};

export type BuildConfig = {
	buildDirectory?: string;
	assetsDirectory?: string;
	publicDirectory?: string;
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
