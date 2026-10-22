import { describe, expect, test } from 'bun:test';
import { managedFilter } from '../../../../src/dev/hot/plugin';

/* A workspace package's source is edited in place like the app's own files;
 * before, an edit there was unmanaged and restarted the server. */
describe('files the backend hot runtime manages', () => {
	const filter = managedFilter({
		configPath: '/ws/web/absolute.config.ts',
		entryPath: '/ws/web/src/backend/server.ts',
		excludedDirs: ['/ws/web/src/frontend'],
		extraRoots: ['/ws/core'],
		root: '/ws/web'
	});

	test('the app and its workspace packages, not what surrounds them', () => {
		expect(filter.test('/ws/web/src/backend/routes.ts')).toBe(true);
		expect(filter.test('/ws/core/greeting.ts')).toBe(true);
		expect(filter.test('/ws/core/nested/procgen.ts?absolute-hot=3')).toBe(
			true
		);
		expect(filter.test('/ws/other/thing.ts')).toBe(false);
	});

	test('generated output, tests, excluded dirs and the config stay unmanaged', () => {
		expect(filter.test('/ws/core/node_modules/x/index.js')).toBe(false);
		expect(filter.test('/ws/core/dist/greeting.js')).toBe(false);
		expect(filter.test('/ws/core/greeting.test.ts')).toBe(false);
		expect(filter.test('/ws/web/src/frontend/pages/Home.tsx')).toBe(false);
		expect(filter.test('/ws/web/absolute.config.ts')).toBe(false);
	});
});
