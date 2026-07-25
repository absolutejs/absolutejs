import { describe, expect, test } from 'bun:test';
import { resolveWorkspaceServicePort } from '../../../src/cli/scripts/workspace';

describe('workspace service port resolution', () => {
	test('does not assign the app default port to portless command services', () => {
		expect(
			resolveWorkspaceServicePort(
				{ command: ['docker', 'compose', 'up'], kind: 'command' },
				{}
			)
		).toBe(0);
	});

	test('honors an explicit command service port', () => {
		expect(
			resolveWorkspaceServicePort(
				{
					command: ['bun', 'run', 'worker.ts'],
					kind: 'command',
					port: 4100
				},
				{}
			)
		).toBe(4100);
	});

	test('keeps the default port for AbsoluteJS application services', () => {
		expect(
			resolveWorkspaceServicePort({ entry: 'src/backend/server.ts' }, {})
		).toBe(3000);
	});
});
