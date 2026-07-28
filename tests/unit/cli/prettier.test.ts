import { describe, expect, test } from 'bun:test';
import {
	buildTargetedPrettierCommand,
	hasPrettierTarget
} from '../../../src/cli/scripts/prettier';

describe('Prettier CLI targeting', () => {
	test('preserves explicit files and directories without workspace expansion', () => {
		expect(
			hasPrettierTarget(['--write', 'src/one.ts', 'src/two.ts'])
		).toBeTrue();
		expect(hasPrettierTarget(['--check', 'src'])).toBeTrue();
		expect(buildTargetedPrettierCommand(['--write', 'src/one.ts'])).toEqual(
			['bun', 'prettier', '--write', 'src/one.ts']
		);
	});

	test('does not mistake option values for positional targets', () => {
		expect(
			hasPrettierTarget([
				'--write',
				'--config',
				'prettier.config.mjs',
				'--parser=typescript'
			])
		).toBeFalse();
		expect(hasPrettierTarget(['--write', '--', 'src/one.ts'])).toBeTrue();
	});
});
