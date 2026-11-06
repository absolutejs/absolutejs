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

/* Bun.build compiles process.env.NODE_ENV as "development" unless told
 * otherwise, whatever the environment says. Packages choose their build from
 * it, so a production bundle could pair a package's development build with the
 * production React it imports. The development reconciler in @react-three/fiber
 * reads React's actQueue, which production React doesn't have, and threw on
 * every page that loaded it (absolutejs.ai, 2026-11-05). */
export const resolveClientDefine = (
	development: boolean,
	define: Record<string, string> = {}
) =>
	development
		? define
		: { ...define, 'process.env.NODE_ENV': '"production"' };
