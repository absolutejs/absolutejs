import type { Component as SvelteComponent } from 'svelte';

export type SveltePropsOf<C> =
	C extends SvelteComponent<infer P> ? P : Record<string, never>;
