import type { Component as SvelteComponent } from 'svelte';
import type { CompileOptions } from 'svelte/compiler';

export type SveltePropsOf<C> =
	C extends SvelteComponent<infer P> ? P : Record<string, never>;

/** Svelte's `cssHash` compile option: the scoped-CSS class for a component. */
export type SvelteCssHashGetter = NonNullable<CompileOptions['cssHash']>;
