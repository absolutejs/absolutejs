import type {
	AllowedComponentProps,
	ComponentCustomProps,
	VNodeProps
} from 'vue';

type ReservedVueProps =
	| keyof VNodeProps
	| keyof AllowedComponentProps
	| keyof ComponentCustomProps;

export type VuePropsOf<C> = C extends new () => { $props: infer Props }
	? Omit<Props, ReservedVueProps>
	: C extends (props: infer Props, ...args: never[]) => unknown
		? Props extends Record<string, unknown>
			? Props
			: Record<string, never>
		: Record<string, never>;

export type VueVNode = {
	children?: VueVNode[];
	component?: VueComponentInstance;
};

export type VueComponentInstance = {
	setupState?: Record<string, unknown>;
	subTree?: VueVNode;
};
