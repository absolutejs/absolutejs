import { describe, expect, test } from 'bun:test';
import type { BuildConfig } from '../../../types/build';
import { resolveServerBundleExternals } from '../../../src/cli/serverBundleExternals';

const config = (input: Partial<BuildConfig>) => input as BuildConfig;

describe('server bundle externals', () => {
	test('applies user externals consistently to production server bundles', () => {
		expect(
			resolveServerBundleExternals(
				config({ bunBuild: { external: ['cpu-features'] } })
			)
		).toContain('cpu-features');
		expect(
			resolveServerBundleExternals(
				config({
					bunBuild: {
						default: { external: ['optional-native-addon'] }
					}
				})
			)
		).toContain('optional-native-addon');
	});

	test('bundles configured framework runtimes and externalizes absent ones', () => {
		const externals = resolveServerBundleExternals(
			config({ reactDirectory: 'src/react' })
		);

		expect(externals).not.toContain('react');
		expect(externals).not.toContain('react-dom');
		expect(externals).toContain('vue');
		expect(externals).toContain('svelte');
	});
});
