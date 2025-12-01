import { ComponentType as ReactComponent } from 'react';
import { Component as SvelteComponent } from 'svelte';
import { Component as VueComponent } from 'vue';
import type { Type, InjectionToken } from '@angular/core';

// Export AngularComponent type alias for convenience
export type AngularComponent<T = unknown> = Type<T>;

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
				: Component extends AngularComponent<infer Props>
					? Props
					: Record<string, never>;

export type PropsArgs<C> = keyof PropsOf<C> extends never ? [] : [PropsOf<C>];

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Standard props interface for Angular page components
 */
export interface AngularPageProps {
	initialCount?: number;
	cssPath?: string;
}

/**
 * Injection tokens for Angular page components
 */
export interface AngularInjectionTokens {
	CSS_PATH?: InjectionToken<string>;
	INITIAL_COUNT?: InjectionToken<number>;
}

/**
 * Type-safe Angular component module export
 */
export interface AngularComponentModule {
	default: AngularComponent<unknown>;
	CSS_PATH?: InjectionToken<string>;
	INITIAL_COUNT?: InjectionToken<number>;
}
