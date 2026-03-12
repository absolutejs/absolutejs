import type { Component as VueComponent } from 'vue';

export type VuePropsOf<C> =
	C extends VueComponent<infer P> ? P : Record<string, never>;

export type VueVNode = {
	children?: VueVNode[];
	component?: VueComponentInstance;
};

export type VueComponentInstance = {
	setupState?: Record<string, unknown>;
	subTree?: VueVNode;
};
