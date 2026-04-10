import { relative, resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createModuleServer } from '../../../src/dev/moduleServer';

const projectRoot = resolve(import.meta.dir, '..', '..', '..');
const awaitFixture = resolve(
	projectRoot,
	'tests',
	'fixtures',
	'svelte',
	'AwaitStreamingPage.svelte'
);
const awaitFixtureUrl = `/@src/${relative(projectRoot, awaitFixture).replace(/\\/g, '/')}`;

describe('createModuleServer Svelte transforms', () => {
	test('lowers #await blocks in dev client modules', async () => {
		const moduleServer = createModuleServer({
			projectRoot,
			vendorPaths: {}
		});

		const response = await moduleServer(awaitFixtureUrl);
		expect(response?.status).toBe(200);
		if (!response) {
			throw new Error('Expected module server response');
		}

		const code = await response.text();

		expect(code).toContain('AwaitSlot.svelte');
		expect(code).not.toContain('{#await');
	});
});
