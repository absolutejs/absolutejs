import { dirname, resolve } from 'node:path';
import type { BunPlugin } from 'bun';

const OPENAPI_TYPEBOX_PREFIX = '../node_modules/typebox/';
const OPENAPI_DISTRIBUTION_SEGMENT = '/@elysia/openapi/dist/';

/**
 * Elysia OpenAPI 2 beta.1 emits relative TypeBox imports that point at a
 * package-local node_modules directory which is not included in its npm
 * artifact. Redirect only those generated imports to the application's
 * declared TypeBox dependency while bundling production servers.
 */
export const createElysiaOpenApiTypeboxPlugin = (): BunPlugin => ({
	name: 'absolute-elysia-openapi-typebox',
	setup(build) {
		build.onResolve(
			{ filter: /^\.\.\/node_modules\/typebox\// },
			(args) => {
				const importer = args.importer.replaceAll('\\', '/');
				if (!importer.includes(OPENAPI_DISTRIBUTION_SEGMENT)) {
					return undefined;
				}
				const relativePath = args.path.slice(
					OPENAPI_TYPEBOX_PREFIX.length
				);
				const typeboxEntry = Bun.resolveSync(
					'typebox',
					dirname(args.importer)
				);

				return {
					path: resolve(dirname(typeboxEntry), '..', relativePath)
				};
			}
		);
	}
});
