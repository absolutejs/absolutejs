import { ComponentType as ReactComponent } from 'react';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent } from 'vue';

export type BuildOptions = {
	preserveIntermediateFiles?: boolean;
	hmr?: {
		debounceMs?: number;
	};
};

/* Host configuration options
   Supports both boolean (true = bind to 0.0.0.0) and string (custom host/IP) */
export type HostConfigOption = boolean | string;

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
	// - true: bind to 0.0.0.0 (all network interfaces)
	// - string: bind to specific host/IP address
	// Priority: CLI flag (--host) > config.host > environment variable (HOST) > default (localhost)
	host?: HostConfigOption;
	// Optional: Port configuration for dev server
	// Priority: CLI flag (--port) > config.port > environment variable (PORT) > default (3000)
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
