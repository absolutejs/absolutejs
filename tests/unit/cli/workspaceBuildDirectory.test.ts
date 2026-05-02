import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { findSharedWorkspaceBuildDirectories } from '../../../src/cli/scripts/workspace';

describe('workspace build directory warnings', () => {
	test('detects absolute services that resolve to the same build directory', () => {
		const shared = resolve('apps/shared-build');
		const result = findSharedWorkspaceBuildDirectories({
			api: {
				buildDirectory: '../shared-build',
				cwd: './apps/api',
				entry: './server.ts'
			},
			worker: {
				command: ['bun', 'run', 'worker.ts'],
				kind: 'command'
			},
			web: {
				buildDirectory: '../shared-build',
				cwd: './apps/web',
				entry: './server.ts'
			}
		});

		expect(result).toEqual([
			{
				buildDirectory: shared,
				names: ['api', 'web']
			}
		]);
	});

	test('ignores different resolved build directories', () => {
		const result = findSharedWorkspaceBuildDirectories({
			api: {
				buildDirectory: '../api-build',
				cwd: './apps/api',
				entry: './server.ts'
			},
			web: {
				buildDirectory: '../web-build',
				cwd: './apps/web',
				entry: './server.ts'
			}
		});

		expect(result).toEqual([]);
	});
});
