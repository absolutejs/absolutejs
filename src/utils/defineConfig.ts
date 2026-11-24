import type {
	AbsoluteServiceConfig,
	CommandServiceConfig,
	ReservedConfigKey
} from '../../types/build';

type ServiceName<TConfig> = Extract<keyof TConfig, string>;

type HasReservedConfigKeys<TConfig> =
	Extract<ServiceName<TConfig>, ReservedConfigKey> extends never
		? false
		: true;

type ServiceDependsOn<TConfig, TSelf extends string> = readonly Exclude<
	ServiceName<TConfig>,
	TSelf
>[];

type TypedAbsoluteServiceConfig<TConfig, TSelf extends string> = Omit<
	AbsoluteServiceConfig,
	'dependsOn'
> & {
	dependsOn?: ServiceDependsOn<TConfig, TSelf>;
};

type TypedCommandServiceConfig<TConfig, TSelf extends string> = Omit<
	CommandServiceConfig,
	'dependsOn'
> & {
	dependsOn?: ServiceDependsOn<TConfig, TSelf>;
};

type TypedWorkspaceConfig<TConfig extends Record<string, unknown>> = {
	[K in keyof TConfig]: K extends string
		? | TypedAbsoluteServiceConfig<TConfig, K>
			| TypedCommandServiceConfig<TConfig, K>
		: never;
};

type ServiceBuildDirectory<
	TConfig,
	TKey extends keyof TConfig
> = TConfig[TKey] extends { command: readonly unknown[] }
	? never
	: TConfig[TKey] extends { kind: 'command' }
		? never
		: TConfig[TKey] extends { buildDirectory: infer TBuildDirectory }
			? TBuildDirectory extends string
				? TBuildDirectory
				: never
			: never;

/* A service with no literal `buildDirectory` has `never` here, and `never`
 * extends everything: unguarded, every such service counted as sharing
 * every other service's directory, so a workspace where one service set
 * `buildDirectory` and another did not was reported as a duplicate. */
type ServicesWithBuildDirectory<
	TConfig extends Record<string, unknown>,
	TBuildDirectory extends string
> = {
	[K in keyof TConfig]: [ServiceBuildDirectory<TConfig, K>] extends [never]
		? never
		: ServiceBuildDirectory<TConfig, K> extends TBuildDirectory
			? K
			: never;
}[keyof TConfig];

type IsUnion<TValue, TCompare = TValue> = TValue extends unknown
	? [TCompare] extends [TValue]
		? false
		: true
	: never;

type DuplicateBuildDirectoryValues<TConfig extends Record<string, unknown>> = {
	[K in keyof TConfig]: ServiceBuildDirectory<
		TConfig,
		K
	> extends infer TBuildDirectory
		? TBuildDirectory extends string
			? IsUnion<
					ServicesWithBuildDirectory<TConfig, TBuildDirectory>
				> extends true
				? TBuildDirectory
				: never
			: never
		: never;
}[keyof TConfig];

type ValidateUniqueBuildDirectories<TConfig extends Record<string, unknown>> = [
	DuplicateBuildDirectoryValues<TConfig>
] extends [never]
	? unknown
	: {
			/**
			 * Workspace services cannot use duplicate literal buildDirectory values.
			 * Runtime workspace validation also checks resolved absolute paths.
			 */
			__absolute_duplicateBuildDirectory__: DuplicateBuildDirectoryValues<TConfig>;
		};

/* `defineConfig` infers its argument, and TypeScript makes no
 * excess-property check on an inferred type: a misspelt key
 * (`reactDirectroy`) and a key that no longer exists both passed, and the
 * setting silently did not happen. So the keys that are not config keys
 * are given a type no value satisfies, named for what is wrong. An
 * object type and not `never` or a string literal: either of those
 * collapses the whole config to `never`, and the checker then blames
 * every correct key as well. */
type UnknownConfigKey<TKey extends string> = {
	/** This key is not one AbsoluteJS reads. Check its spelling. */
	__absolute_unknownConfigKey__: TKey;
};

type RejectUnknownKeys<TValue, TKnown> = {
	[K in Exclude<Extract<keyof TValue, string>, TKnown>]: UnknownConfigKey<K>;
};

type ServiceKeys<TService> = TService extends { command: readonly unknown[] }
	? keyof CommandServiceConfig
	: TService extends { kind: 'command' }
		? keyof CommandServiceConfig
		: keyof AbsoluteServiceConfig;

type RejectUnknownServiceKeys<TConfig extends Record<string, unknown>> = {
	[K in keyof TConfig]: RejectUnknownKeys<
		TConfig[K],
		ServiceKeys<TConfig[K]>
	>;
};

type ValidateConfig<TConfig extends Record<string, unknown>> =
	HasReservedConfigKeys<TConfig> extends true
		? AbsoluteServiceConfig &
				RejectUnknownKeys<TConfig, keyof AbsoluteServiceConfig>
		: TypedWorkspaceConfig<TConfig> &
				ValidateUniqueBuildDirectories<TConfig> &
				RejectUnknownServiceKeys<TConfig>;

export const defineConfig = <const TConfig extends Record<string, unknown>>(
	config: TConfig & ValidateConfig<TConfig>
) => config;
