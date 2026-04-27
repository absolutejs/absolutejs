export type IslandFramework = 'react' | 'svelte' | 'vue' | 'angular';

export type IslandHydrate = 'load' | 'idle' | 'visible' | 'none';

export type AngularIslandComponent = abstract new (...args: never[]) => object;

export type IslandComponentDefinition<Component> = {
	component: Component;
	export?: string;
	source: string;
};

export type IslandRegistryInput = Partial<
	Record<IslandFramework, Record<string, unknown>>
>;

type UnwrapIslandComponent<Component> =
	Component extends IslandComponentDefinition<infer InnerComponent>
		? InnerComponent
		: Component;

type ExtractCallableProps<Component> = Component extends (
	props: infer Props,
	...args: never[]
) => unknown
	? NormalizeProps<Props>
	: Record<string, never>;

type ExtractConstructedProps<Component> = Component extends abstract new (
	props: infer Props,
	...args: never[]
) => unknown
	? NormalizeProps<Props>
	: Record<string, never>;

type ExtractReactProps<Component> =
	ExtractCallableProps<Component> extends infer Props
		? Props extends Record<string, never>
			? ExtractConstructedProps<Component>
			: Props
		: Record<string, never>;

type ExtractSvelteProps<Component> = Component extends (
	internals: unknown,
	props: infer Props,
	...args: never[]
) => unknown
	? NormalizeProps<Props>
	: Component extends abstract new (
				options: { props?: infer Props },
				...args: never[]
		  ) => unknown
		? NormalizeProps<Props>
		: Record<string, never>;

type ReservedVueProps =
	| 'key'
	| 'ref'
	| 'ref_for'
	| 'ref_key'
	| 'class'
	| 'style'
	| 'onVnodeBeforeMount'
	| 'onVnodeMounted'
	| 'onVnodeBeforeUpdate'
	| 'onVnodeUpdated'
	| 'onVnodeBeforeUnmount'
	| 'onVnodeUnmounted';

type ExtractVueProps<Component> = Component extends abstract new () => {
	$props: infer Props;
}
	? NormalizeProps<Omit<Props, ReservedVueProps>>
	: ExtractCallableProps<Component>;

type ExtractAngularProps<Component> =
	UnwrapIslandComponent<Component> extends {
		__absoluteProps?: infer Props;
	}
		? NormalizeProps<Props>
		: Record<string, never>;

type ExtractFrameworkProps<
	Framework extends IslandFramework,
	Component
> = Framework extends 'react'
	? ExtractReactProps<UnwrapIslandComponent<Component>>
	: Framework extends 'svelte'
		? ExtractSvelteProps<UnwrapIslandComponent<Component>>
		: Framework extends 'vue'
			? ExtractVueProps<UnwrapIslandComponent<Component>>
			: Framework extends 'angular'
				? ExtractAngularProps<Component>
				: never;

type NormalizeProps<Props> =
	Props extends Record<string, unknown> ? Props : Record<string, never>;

export type IslandRegistry<T extends IslandRegistryInput> = T;

export type InferredIslandRegistry<T extends IslandRegistryInput> = {
	[F in keyof T]: T[F] extends Record<string, object>
		? {
				[K in keyof T[F]]: NormalizeProps<
					ExtractFrameworkProps<F & IslandFramework, T[F][K]>
				>;
			}
		: never;
};

export type IslandRegistryFramework<T extends IslandRegistryInput> = Extract<
	keyof T,
	IslandFramework
>;

export type IslandRegistryComponent<
	T extends IslandRegistryInput,
	Framework extends IslandRegistryFramework<T>
> = Extract<keyof NonNullable<T[Framework]>, string>;

export type IslandRegistryProps<
	T extends IslandRegistryInput,
	Framework extends IslandRegistryFramework<T>,
	Component extends IslandRegistryComponent<T, Framework>
> =
	ExtractFrameworkProps<
		Framework,
		NonNullable<T[Framework]>[Component]
	> extends infer Props
		? NormalizeProps<Props>
		: Record<string, never>;

export type RuntimeIslandRenderProps = {
	component: string;
	framework: IslandFramework;
	hydrate?: IslandHydrate;
	props: Record<string, unknown>;
};

export type TypedIslandRenderProps<T extends IslandRegistryInput> = {
	[Framework in IslandRegistryFramework<T>]: {
		[Component in IslandRegistryComponent<T, Framework>]: {
			component: Component;
			framework: Framework;
			hydrate?: IslandHydrate;
			props: IslandRegistryProps<T, Framework, Component>;
		};
	}[IslandRegistryComponent<T, Framework>];
}[IslandRegistryFramework<T>];
