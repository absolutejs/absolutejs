import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `absolute i18n check` through the published CLI, which is how CI would
 * run it. The exit code is the contract: a missing key, a renamed
 * argument or a malformed message fails; an unused key is reported and
 * does not. */

const CLI_ENTRY = resolve(
	import.meta.dir,
	'..',
	'..',
	'..',
	'dist',
	'cli',
	'index.js'
);

type Catalog = { home: Record<string, string> };

const ENGLISH: Catalog = {
	home: {
		items: '{count, plural, one {# item} other {# items}}',
		sub: 'Subscribe',
		title: 'Welcome {name}'
	}
};

let directory: string;

const write = async (name: string, catalog: unknown) => {
	const path = join(directory, name);
	await writeFile(path, JSON.stringify(catalog));

	return path;
};

const run = async (args: string[]) => {
	const proc = Bun.spawn(['bun', CLI_ENTRY, 'i18n', ...args], {
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	return { exitCode, output: `${stdout}${stderr}` };
};

beforeAll(async () => {
	await ensureDistBuild();
	directory = await mkdtemp(join(tmpdir(), 'absolute-i18n-check-'));
}, 600_000);

afterAll(async () => {
	if (directory) await rm(directory, { force: true, recursive: true });
});

describe('absolute i18n check', () => {
	test('passes a faithful translation', async () => {
		const english = await write('en.json', ENGLISH);
		const french = await write('fr.json', {
			home: {
				items: '{count, plural, one {# article} other {# articles}}',
				sub: 'Abonnez-vous',
				title: 'Bienvenue {name}'
			}
		});
		const { exitCode, output } = await run(['check', english, french]);

		expect(exitCode).toBe(0);
		expect(output).toContain('✓');
	}, 120_000);

	test('fails a catalog that is missing a key', async () => {
		const english = await write('en.json', ENGLISH);
		const partial = await write('partial.json', {
			home: {
				items: '{count, plural, one {# article} other {# articles}}',
				title: 'Bienvenue {name}'
			}
		});
		const { exitCode, output } = await run(['check', english, partial]);

		expect(exitCode).toBe(1);
		expect(output).toContain('missing home.sub');
	}, 120_000);

	test('fails a renamed ICU argument and a malformed message', async () => {
		const english = await write('en.json', ENGLISH);
		const broken = await write('broken.json', {
			home: {
				items: '{count, plural, one {# article} other {# articles}',
				sub: 'Abonnez-vous',
				title: 'Bienvenue {nom}'
			}
		});
		const { exitCode, output } = await run(['check', english, broken]);

		expect(exitCode).toBe(1);
		expect(output).toContain('mismatch home.title');
		expect(output).toContain('icu home.items');
	}, 120_000);

	test('reports an unused key without failing', async () => {
		const english = await write('en.json', ENGLISH);
		const extra = await write('extra.json', {
			home: {
				extra: 'Inutile',
				items: '{count, plural, one {# article} other {# articles}}',
				sub: 'Abonnez-vous',
				title: 'Bienvenue {name}'
			}
		});
		const { exitCode, output } = await run(['check', english, extra]);

		// Dead weight, not a broken page.
		expect(output).toContain('extra home.extra');
		expect(exitCode).toBe(0);
	}, 120_000);

	test('--json prints the report for a workflow to read', async () => {
		const english = await write('en.json', ENGLISH);
		const partial = await write('partial.json', { home: {} });
		const { exitCode, output } = await run([
			'check',
			english,
			partial,
			'--json'
		]);
		const parsed: unknown = JSON.parse(output);

		expect(exitCode).toBe(1);
		expect(parsed).toMatchObject({ default: english });
	}, 120_000);

	test('a catalog that is not messages says so', async () => {
		const english = await write('en.json', ENGLISH);
		const notACatalog = await write('bad.json', { home: { title: 42 } });
		const { exitCode, output } = await run(['check', english, notACatalog]);

		expect(exitCode).not.toBe(0);
		expect(output).toContain('not a catalog');
	}, 120_000);

	test('without a subcommand it prints usage', async () => {
		const { exitCode, output } = await run([]);

		expect(exitCode).toBe(1);
		expect(output).toContain('Usage: absolute i18n check');
	}, 120_000);
});
