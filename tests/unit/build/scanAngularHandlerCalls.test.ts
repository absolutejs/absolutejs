import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAngularHandlerCalls } from '../../../src/build/scanAngularHandlerCalls';

const temporaryDirectories: string[] = [];

const createProject = () => {
	const directory = mkdtempSync(join(tmpdir(), 'absolute-angular-scan-'));
	temporaryDirectories.push(directory);

	return directory;
};

const serverSource = (mountPath: string) => `
	app.get('${mountPath}', () =>
		handleAngularPageRequest({
			pagePath: asset(manifest, 'AngularExample')
		})
	);
`;

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('scanAngularHandlerCalls', () => {
	test('ignores framework-owned hot-reload entry copies', () => {
		const projectRoot = createProject();
		writeFileSync(join(projectRoot, 'server.ts'), serverSource('/angular/*'));
		writeFileSync(
			join(projectRoot, '.absolutejs-hmr-123-0.ts'),
			serverSource('/angular')
		);

		expect(scanAngularHandlerCalls(projectRoot)).toEqual([
			{
				manifestKey: 'AngularExample',
				mountPath: '/angular/*',
				sourceFile: join(projectRoot, 'server.ts')
			}
		]);
	});
});
