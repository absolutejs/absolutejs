import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createElysiaOpenApiTypeboxPlugin } from '../../../src/cli/elysiaOpenApiTypeboxPlugin';

describe('Elysia OpenAPI TypeBox resolver', () => {
	test('bundles the published beta generator without package-local dependencies', async () => {
		const result = await Bun.build({
			entrypoints: [
				join(
					process.cwd(),
					'node_modules/@elysia/openapi/dist/gen/index.mjs'
				)
			],
			external: ['elysia'],
			plugins: [createElysiaOpenApiTypeboxPlugin()],
			target: 'bun',
			throw: false
		});

		expect(result.logs).toEqual([]);
		expect(result.success).toBe(true);
	});
});
