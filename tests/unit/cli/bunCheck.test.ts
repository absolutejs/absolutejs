import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	bunCheckCommand,
	bunCheckSupported,
	checkFingerprint
} from '../../../src/cli/scripts/bunCheck';

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { force: true, recursive: true });
});

const project = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'bun-check-'));
	directories.push(directory);
	const root = join(directory, 'tsconfig.json');
	const generated = join(directory, 'tsconfig.typecheck.json');
	const source = join(directory, 'index.ts');
	await writeFile(root, '{ "compilerOptions": { "strict": true } }');
	// The generated config extends the project's by absolute path.
	await writeFile(generated, JSON.stringify({ extends: root }));
	await writeFile(source, 'export const a = 1;\n');

	return {
		generated,
		listing: `bundled:///libs/lib.es5.d.ts\n${source}\n`,
		root,
		source
	};
};

describe('bun check gating', () => {
	test('needs Bun 1.4.3 or later', () => {
		expect(bunCheckSupported('1.4.2', {})).toBe(false);
		expect(bunCheckSupported('1.4.3', {})).toBe(true);
		expect(bunCheckSupported('1.5.0', {})).toBe(true);
	});

	test('ABSOLUTE_TYPECHECK_CHECKER=tsc keeps tsc', () => {
		expect(
			bunCheckSupported('1.4.3', { ABSOLUTE_TYPECHECK_CHECKER: 'tsc' })
		).toBe(false);
	});

	test('asks for source excerpts only when a person is watching', () => {
		expect(bunCheckCommand('/p/tsconfig.json', {}, '/bun', true)).toContain(
			'--pretty=true'
		);
		expect(
			bunCheckCommand('/p/tsconfig.json', {}, '/bun', false)
		).not.toContain('--pretty=true');
	});

	test('passes a positive thread cap through and ignores anything else', () => {
		const base = ['/bun', 'check', '-p', '/p/tsconfig.json', '--all'];
		expect(bunCheckCommand('/p/tsconfig.json', {}, '/bun', false)).toEqual(
			base
		);
		expect(
			bunCheckCommand(
				'/p/tsconfig.json',
				{ ABSOLUTE_TYPECHECK_THREADS: '2' },
				'/bun',
				false
			)
		).toEqual([...base, '--threads=2']);
		for (const bad of ['0', '-1', 'many', '1.5'])
			expect(
				bunCheckCommand(
					'/p/tsconfig.json',
					{ ABSOLUTE_TYPECHECK_THREADS: bad },
					'/bun',
					false
				)
			).toEqual(base);
	});
});

describe('bun check fingerprint', () => {
	test('is stable for an unchanged program', async () => {
		const { generated, listing } = await project();
		expect(checkFingerprint(listing, generated, '1.4.3')).toBe(
			checkFingerprint(listing, generated, '1.4.3')
		);
	});

	test('changes when a checked file is edited', async () => {
		const { generated, listing, source } = await project();
		const before = checkFingerprint(listing, generated, '1.4.3');
		await writeFile(source, 'export const a = 2;\n');
		await utimes(source, new Date(), new Date(Date.now() + 5_000));
		expect(checkFingerprint(listing, generated, '1.4.3')).not.toBe(before);
	});

	test('changes when the program gains a file', async () => {
		const { generated, listing, source } = await project();
		const added = source.replace('index.ts', 'extra.ts');
		await writeFile(added, 'export {};\n');
		expect(
			checkFingerprint(`${listing}${added}\n`, generated, '1.4.3')
		).not.toBe(checkFingerprint(listing, generated, '1.4.3'));
	});

	// Compiler options change the result without changing the file list.
	test('changes when a tsconfig in the extends chain changes', async () => {
		const { generated, listing, root } = await project();
		const before = checkFingerprint(listing, generated, '1.4.3');
		await writeFile(root, '{ "compilerOptions": { "strict": false } }');
		expect(checkFingerprint(listing, generated, '1.4.3')).not.toBe(before);
	});

	test('changes with the Bun version', async () => {
		const { generated, listing } = await project();
		expect(checkFingerprint(listing, generated, '1.4.3')).not.toBe(
			checkFingerprint(listing, generated, '1.4.4')
		);
	});

	test('is null when the listing names no files', async () => {
		const { generated } = await project();
		expect(
			checkFingerprint('bundled:///libs/lib.es5.d.ts\n', generated)
		).toBeNull();
	});
});
