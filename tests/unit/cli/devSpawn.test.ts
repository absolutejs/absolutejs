import { describe, expect, test } from 'bun:test';
import { devChildSpawnOptions } from '../../../src/cli/devSpawn';

describe('absolute dev child spawn options', () => {
	test('keeps detached process groups hidden on Windows', () => {
		const options = devChildSpawnOptions('/tmp/project', {
			NODE_ENV: 'development'
		});

		expect(options.detached).toBe(true);
		expect(options.windowsHide).toBe(process.platform === 'win32');
		expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe', 'pipe']);
	});
});
