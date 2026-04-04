import type {
	InputSignalWithTransform as AngularInputSignalWithTransform,
	Type as AngularComponent,
	ɵUnwrapDirectiveSignalInputs as UnwrapAngularSignalInputs
} from '@angular/core';
import type { ReactPropsOf } from './react';
import type { SveltePropsOf } from './svelte';
import type { VuePropsOf } from './vue';

export type IslandFramework = 'react' | 'svelte' | 'vue' | 'angular';

export type IslandHydrate = 'load' | 'idle' | 'visible' | 'none';

export type AngularIslandComponent = AngularComponent<object>;

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

type AngularSignalInputKeys<Instance> = Extract<
	{
		[K in keyof Instance]: Instance[K] extends AngularInputSignalWithTransform<
			unknown,
			unknown
		>
			? K
			: never;
	}[keyof Instance],
	keyof Instance
>;

type ExtractAngularProps<Component> =
	UnwrapIslandComponent<Component> extends AngularComponent<infer Instance>
		? AngularSignalInputKeys<Instance> extends never
			? UnwrapIslandComponent<Component> extends {
					__absoluteProps?: infer Props;
				}
				? NormalizeProps<Props>
				: Record<string, never>
			: NormalizeProps<
					UnwrapAngularSignalInputs<
						Instance,
						AngularSignalInputKeys<Instance>
					>
				>
		: Record<string, never>;

type ExtractFrameworkProps<
	Framework extends IslandFramework,
	Component
> = Framework extends 'react'
	? ReactPropsOf<UnwrapIslandComponent<Component>>
	: Framework extends 'svelte'
		? SveltePropsOf<UnwrapIslandComponent<Component>>
		: Framework extends 'vue'
			? VuePropsOf<UnwrapIslandComponent<Component>>
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
