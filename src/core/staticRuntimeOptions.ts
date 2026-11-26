import type { StaticConfig } from '../../types/build';

/* Where a server's pre-rendered pages live, and the secret that lets
 * something outside it revalidate them, taken from the ENVIRONMENT the
 * server starts in.
 *
 * A production server does not read `absolute.config.ts`. It reads what
 * the build wrote down from it, so `static.directory: process.env.X` in
 * a config is whatever `X` was on the build machine — fixed into a
 * prebuilt directory or a compiled binary, for a path that differs from
 * one machine to the next. And a token written the same way was a secret
 * sitting in build output: in the build folder, in any image made from
 * it, in the binary.
 *
 * So both are read here, at startup, and the environment wins. The
 * token is also left out of what the build writes
 * (`withoutRevalidateToken`); `absolute start` hands the config's value
 * to the server it launches through this same variable, so nothing
 * changes for an app that builds and starts in one step. */

export const REVALIDATE_TOKEN_ENV = 'ABSOLUTE_REVALIDATE_TOKEN';
export const STATIC_DIRECTORY_ENV = 'ABSOLUTE_STATIC_DIRECTORY';

/** Left in the written config where a token was removed, so a server
 *  started without the variable can say what is missing instead of
 *  quietly having no endpoint. */
const TOKEN_OMITTED_KEY = 'revalidateTokenOmitted';

type Environment = Record<string, string | undefined>;

const fromEnvironment = (env: Environment, name: string) => {
	const value = env[name];

	return value === undefined || value === '' ? undefined : value;
};

/** Whether the app was built with a token that this server was not
 *  given: the endpoint will not exist, and the reason is not obvious. */
export const isRevalidateTokenMissing = (
	staticConfig: StaticConfig | undefined,
	env: Environment = process.env
) =>
	staticConfig !== undefined &&
	Reflect.get(staticConfig, TOKEN_OMITTED_KEY) === true &&
	revalidateTokenFor(staticConfig, env) === undefined;

/** The revalidation token for this server: the environment's, else the
 *  config's — which only a config loaded from source still carries. */
export const revalidateTokenFor = (
	staticConfig: StaticConfig | undefined,
	env: Environment = process.env
) =>
	fromEnvironment(env, REVALIDATE_TOKEN_ENV) ?? staticConfig?.revalidateToken;

/** `static.directory` for this server: the environment's, else the
 *  config's. */
export const staticDirectoryFor = (
	staticConfig: StaticConfig | undefined,
	env: Environment = process.env
) => fromEnvironment(env, STATIC_DIRECTORY_ENV) ?? staticConfig?.directory;

/** `static` as it may be written into build output: without the token,
 *  and with a mark that there was one. */
export const withoutRevalidateToken = <Static extends StaticConfig | undefined>(
	staticConfig: Static
) => {
	if (staticConfig?.revalidateToken === undefined) return staticConfig;
	const { revalidateToken: _secret, ...rest } = staticConfig;

	return { ...rest, [TOKEN_OMITTED_KEY]: true };
};
