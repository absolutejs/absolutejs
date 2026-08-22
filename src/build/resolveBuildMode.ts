import type { BuildConfig } from '../../types/build';

export const resolveBuildDevelopmentMode = (
	mode: BuildConfig['mode'],
	nodeEnv: string | undefined
) =>
	mode === 'development' || (mode === undefined && nodeEnv === 'development');

export const resolveVueFeatureFlags = (development: boolean) => ({
	__VUE_OPTIONS_API__: 'true',
	__VUE_PROD_DEVTOOLS__: development ? 'true' : 'false',
	__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: development ? 'true' : 'false'
});
