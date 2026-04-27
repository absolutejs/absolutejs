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

type ValidateConfig<TConfig extends Record<string, unknown>> =
	HasReservedConfigKeys<TConfig> extends true
		? AbsoluteServiceConfig
		: TypedWorkspaceConfig<TConfig>;

export const defineConfig = <const TConfig extends Record<string, unknown>>(
	config: TConfig & ValidateConfig<TConfig>
) => config;
