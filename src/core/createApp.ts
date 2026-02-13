import { env } from 'node:process';
import type { AnyElysia } from 'elysia';
import { Elysia } from 'elysia';
import { build } from './build';
import type { BuildConfig, BuildResult } from '../types';
import { devBuild, hmr } from '../dev';
import type { HMRState } from '../dev/clientManager';
import { networking } from '../plugins/networking';

/** Result passed to setup(): BuildResult with optional hmrState (present in dev) */
export type CreateAppResult = BuildResult & {
	hmrState?: HMRState | null;
};

/** Setup function: receives build result, returns Elysia app with routes.
 *  Do not add hmr() or networking() – createApp wires these automatically. */
export type CreateAppSetup = (result: CreateAppResult) => AnyElysia;

/** Creates an AbsoluteJS app: runs build or devBuild based on NODE_ENV,
 *  calls setup with the result, then wires HMR and networking.
 *  Users define routes in setup; HMR and server lifecycle are handled internally.
 *  HMR is applied before the setup app so its onAfterHandle wraps all HTML responses. */
export async function createApp(
	config: BuildConfig,
	setup: CreateAppSetup
): Promise<AnyElysia> {
	const isDev = env.NODE_ENV !== 'production';
	const result: CreateAppResult = isDev
		? await devBuild(config)
		: await build(config);

	let app: AnyElysia = new Elysia();
	if (result.hmrState) {
		app = app.use(hmr(result.hmrState, result.manifest));
	}
	app = app.use(setup(result));
	app = app.use(networking({ hmrState: result.hmrState }));

	return app;
}
