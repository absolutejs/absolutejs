import { describe, expect, test } from 'bun:test';
import { shouldEmbedCompiledAsset } from '../../../src/cli/scripts/compile';

describe('compile asset embedding', () => {
	test('embeds public generated CSS assets', () => {
		expect(
			shouldEmbedCompiledAsset('assets/css/tailwind.generated.css')
		).toBe(true);
	});

	test('skips internal .generated directories', () => {
		expect(
			shouldEmbedCompiledAsset('react/.generated/indexes/page.js')
		).toBe(false);
	});
});
