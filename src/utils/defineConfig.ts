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
		?
				| TypedAbsoluteServiceConfig<TConfig, K>
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

type ServicesWithBuildDirectory<
	TConfig extends Record<string, unknown>,
	TBuildDirectory extends string
> = {
	[K in keyof TConfig]: ServiceBuildDirectory<
		TConfig,
		K
	> extends TBuildDirectory
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

type ValidateConfig<TConfig extends Record<string, unknown>> =
	HasReservedConfigKeys<TConfig> extends true
		? AbsoluteServiceConfig
		: TypedWorkspaceConfig<TConfig> &
				ValidateUniqueBuildDirectories<TConfig>;

export const defineConfig = <const TConfig extends Record<string, unknown>>(
	config: TConfig & ValidateConfig<TConfig>
) => config;
