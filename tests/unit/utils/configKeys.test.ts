import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CONFIG_KEYS,
	describeUnknownConfigKeys
} from '../../../src/utils/configKeys';
import { loadConfig } from '../../../src/utils/loadConfig';

/* A config key nothing reads is a setting that silently does not happen.
 * The type catches it for a config that is type-checked; these are about
 * the one that is not — plain JavaScript, or a project that never runs
 * the checker — which is told when the config is loaded. */

describe('describeUnknownConfigKeys', () => {
	test('a config of real keys has nothing to report', () => {
		expect(
			describeUnknownConfigKeys({
				buildDirectory: 'build',
				reactDirectory: 'src/react',
				tailwind: { input: 'a.css', output: 'b.css' }
			})
		).toEqual([]);
	});

	test('a misspelt key is named with the key it was meant to be', () => {
		expect(
			describeUnknownConfigKeys({ reactDirectroy: 'src/react' })
		).toEqual([
			'absolute.config.ts sets "reactDirectroy", which is not a config key, so it is ignored. Did you mean "reactDirectory"?'
		]);
	});

	test('a key close to nothing is reported without a guess', () => {
		expect(describeUnknownConfigKeys({ webpack: {} })).toEqual([
			'absolute.config.ts sets "webpack", which is not a config key, so it is ignored.'
		]);
	});

	test('every key is reported, in the order the config has them', () => {
		const messages = describeUnknownConfigKeys({
			prot: 3000,
			reactDirectory: 'src/react',
			tailwnd: {}
		});

		expect(messages).toHaveLength(2);
		expect(messages[0]).toContain('"prot"');
		expect(messages[0]).toContain('"port"');
		expect(messages[1]).toContain('"tailwnd"');
		expect(messages[1]).toContain('"tailwind"');
	});

	/* The list is checked against the type in both directions by the
	 * compiler; this is the part the compiler cannot see. */
	test('the key list has no repeats', () => {
		expect(new Set(CONFIG_KEYS).size).toBe(CONFIG_KEYS.length);
	});
});

describe('loadConfig', () => {
	let directory = '';

	afterEach(async () => {
		if (directory) await rm(directory, { force: true, recursive: true });
		directory = '';
	});

	const writeConfig = async (name: string, body: string) => {
		directory = await mkdtemp(join(tmpdir(), 'absolute-config-keys-'));
		const path = join(directory, name);
		await writeFile(path, body);

		return path;
	};

	const warningsFrom = async (path: string) => {
		const log = spyOn(console, 'log').mockImplementation(() => {});
		try {
			await loadConfig(path);
			await loadConfig(path);

			return log.mock.calls
				.map(([line]) => String(line))
				.filter((line) => line.includes('not a config key'));
		} finally {
			log.mockRestore();
		}
	};

	test('warns about an unknown key, once however often it is loaded', async () => {
		const path = await writeConfig(
			'typo.config.mjs',
			"export default { reactDirectory: 'src/react', svelteDirectroy: 'src/svelte' };\n"
		);
		const warnings = await warningsFrom(path);

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('"svelteDirectroy"');
		expect(warnings[0]).toContain('Did you mean "svelteDirectory"?');
	});

	test('says nothing about a config of real keys', async () => {
		const path = await writeConfig(
			'clean.config.mjs',
			"export default { buildDirectory: 'build', reactDirectory: 'src/react' };\n"
		);

		expect(await warningsFrom(path)).toEqual([]);
	});

	test('still returns the config, unknown key and all', async () => {
		const path = await writeConfig(
			'kept.config.mjs',
			"export default { reactDirectory: 'src/react', vueDirectroy: 'src/vue' };\n"
		);
		const log = spyOn(console, 'log').mockImplementation(() => {});
		const config = await loadConfig(path);
		log.mockRestore();

		expect(config).toMatchObject({ reactDirectory: 'src/react' });
	});
});
