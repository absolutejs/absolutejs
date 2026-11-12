import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_ISLAND_BOOTSTRAP_NAME,
	findBootstrapOutputPath
} from '../../../src/build/islandBootstrap';
import { ISLAND_BOOTSTRAP_MANIFEST_KEY } from '../../../src/core/islandManifest';
import { toPascal } from '../../../src/utils/stringModifiers';

const entry = (path: string, hash: string) => ({
	hash,
	kind: 'entry-point' as const,
	path
});

describe('default island bootstrap', () => {
	test('its file name PascalCases to the reserved manifest key', () => {
		expect(toPascal(DEFAULT_ISLAND_BOOTSTRAP_NAME)).toBe(
			ISLAND_BOOTSTRAP_MANIFEST_KEY
		);
	});
});

describe('findBootstrapOutputPath', () => {
	test.each(['bootstrap.ts', 'startIslands.ts', 'bootstrapClient.ts', 'main.tsx'])(
		'finds the output for a bootstrap named %s',
		(fileName) => {
			const stem = fileName.replace(/\.tsx?$/, '');
			const outputs = [
				entry('/app/build/pages/index.abc.js', 'abc'),
				entry(`/app/build/islands/${stem}.h4sh.js`, 'h4sh'),
				{ hash: 'zzz', kind: 'chunk' as const, path: '/app/build/chunk-zzz.js' }
			];

			expect(
				findBootstrapOutputPath({
					bootstrapPath: `/app/src/islands/${fileName}`,
					buildPath: '/app/build',
					outputs,
					passRoot: '/app/src'
				})
			).toBe(`/islands/${stem}.h4sh.js`);
		}
	);

	test('ignores a same-named entry from another directory', () => {
		const outputs = [entry('/app/build/html/bootstrap.aaa.js', 'aaa')];

		expect(
			findBootstrapOutputPath({
				bootstrapPath: '/app/src/islands/bootstrap.ts',
				buildPath: '/app/build',
				outputs,
				passRoot: '/app/src'
			})
		).toBeUndefined();
	});

	test('matches by name alone when the pass root is unknown', () => {
		const outputs = [entry('/app/build/islands/bootstrap.bbb.js', 'bbb')];

		expect(
			findBootstrapOutputPath({
				bootstrapPath: '/app/src/islands/bootstrap.ts',
				buildPath: '/app/build',
				outputs,
				passRoot: undefined
			})
		).toBe('/islands/bootstrap.bbb.js');
	});
});
