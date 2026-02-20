import type { Component as VueComponent } from 'vue';

export type VuePropsOf<C> =
	C extends VueComponent<infer P> ? P : Record<string, never>;
