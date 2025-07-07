import { ComponentType as ReactComponent } from 'react';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent } from 'vue';

export type BuildOptions = {
	preserveIntermediateFiles?: boolean;
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
