import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyElysia } from 'elysia';
import type { BuildConfig, OpenApiConfig } from '../../types/build';

// Wires @elysiajs/openapi into the runtime so the app gets a Scalar/Swagger UI
// at /openapi derived from the route schemas AbsoluteJS already types — no
// annotation. On by default in dev; opt-in (truthy `openapi`) for production.

const FALLBACK_NAME = 'AbsoluteJS API';
const FALLBACK_VERSION = '1.0.0';

const projectInfo = (cwd: string) => {
	const path = join(cwd, 'package.json');
	if (!existsSync(path)) {
		return { name: FALLBACK_NAME, version: FALLBACK_VERSION };
	}
	try {
		const pkg = JSON.parse(readFileSync(path, 'utf-8'));

		return {
			name: typeof pkg.name === 'string' ? pkg.name : FALLBACK_NAME,
			version:
				typeof pkg.version === 'string' ? pkg.version : FALLBACK_VERSION
		};
	} catch {
		return { name: FALLBACK_NAME, version: FALLBACK_VERSION };
	}
};

export const openApiEnabled = (config: BuildConfig, isDev: boolean) =>
	isDev ? config.openapi !== false : Boolean(config.openapi);

const createOpenApiPlugin = async (config: BuildConfig, cwd: string) => {
	const setting = config.openapi;
	const options: OpenApiConfig = typeof setting === 'object' ? setting : {};
	const info = projectInfo(cwd);
	const { openapi } = await import('@elysiajs/openapi');

	return openapi({
		documentation: {
			info: {
				description: options.documentation?.description,
				title: options.documentation?.title ?? info.name,
				version: options.documentation?.version ?? info.version
			}
		},
		// Keep AbsoluteJS's dev-machinery routes (HMR, source proxy, image
		// optimizer, devtools) out of the user's API docs.
		exclude: {
			paths: [
				/^\/_/,
				/^\/@/,
				/^\/__absolute/,
				/^\/hmr/,
				/^\/\.well-known/,
				/^\/chunk-/,
				/^\/node_modules/
			]
		},
		path: options.path ?? '/openapi',
		provider: options.provider === 'swagger' ? 'swagger-ui' : 'scalar'
	});
};

// Conditionally mounts the OpenAPI plugin onto the runtime app, returning it
// unchanged when disabled.
export const withOpenApi = async (
	app: AnyElysia,
	config: BuildConfig,
	cwd: string,
	isDev: boolean
) => {
	if (!openApiEnabled(config, isDev)) return app;

	try {
		return app.use(await createOpenApiPlugin(config, cwd));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		console.warn(
			`[absolute] OpenAPI docs disabled — install @elysiajs/openapi (${detail})`
		);

		return app;
	}
};
