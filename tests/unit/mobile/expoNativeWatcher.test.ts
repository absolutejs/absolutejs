import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createAbsoluteExpoNativeWatcher,
	fingerprintAbsoluteExpoNativeInputs,
	isAbsoluteExpoNativeRootInput
} from '../../../src/mobile/expoNativeWatcher';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'absolute-expo-watch-'));
	temporaryDirectories.push(projectRoot);
	const expoProjectDirectory = join(
		projectRoot,
		'.absolutejs',
		'mobile',
		'expo'
	);
	await mkdir(join(expoProjectDirectory, 'modules', 'device'), {
		recursive: true
	});
	await mkdir(join(expoProjectDirectory, 'plugins'), { recursive: true });
	await mkdir(join(expoProjectDirectory, 'app'), { recursive: true });
	await writeFile(join(projectRoot, 'package.json'), '{}\n');
	await writeFile(
		join(expoProjectDirectory, 'modules', 'device', 'index.ts'),
		'export const native = true;\n'
	);
	await writeFile(
		join(expoProjectDirectory, 'plugins', 'withDevice.js'),
		'module.exports = value => value;\n'
	);
	await writeFile(
		join(expoProjectDirectory, 'app', 'index.tsx'),
		'export default () => null;\n'
	);

	return { expoProjectDirectory, projectRoot };
};

describe('Expo native input watcher', () => {
	test('classifies only application inputs that can change the native projection', () => {
		expect(isAbsoluteExpoNativeRootInput('absolute.config.ts')).toBe(true);
		expect(isAbsoluteExpoNativeRootInput('bun.lock')).toBe(true);
		expect(isAbsoluteExpoNativeRootInput('README.md')).toBe(false);
	});

	test('fingerprints native modules and config plugins but not Metro-owned routes', async () => {
		const project = await fixture();
		const before = await fingerprintAbsoluteExpoNativeInputs(project);
		await writeFile(
			join(project.expoProjectDirectory, 'app', 'index.tsx'),
			'export default () => "fast refresh";\n'
		);
		expect(await fingerprintAbsoluteExpoNativeInputs(project)).toBe(before);
		await writeFile(
			join(project.expoProjectDirectory, 'modules', 'device', 'index.ts'),
			'export const native = "changed";\n'
		);
		expect(await fingerprintAbsoluteExpoNativeInputs(project)).not.toBe(
			before
		);
	});

	test('coalesces a native module edit into one rebuild request', async () => {
		const project = await fixture();
		let resolveChange: (() => void) | undefined;
		const changed = new Promise<void>((resolve) => {
			resolveChange = resolve;
		});
		const changes: string[][] = [];
		const watcher = await createAbsoluteExpoNativeWatcher({
			...project,
			debounceMs: 20,
			onChange: async (change) => {
				changes.push(change.paths);
				resolveChange?.();
			}
		});
		await writeFile(
			join(project.expoProjectDirectory, 'modules', 'device', 'index.ts'),
			'export const native = "rebuilt";\n'
		);
		await Promise.race([
			changed,
			Bun.sleep(5_000).then(() => {
				throw new Error('Timed out waiting for Expo native change.');
			})
		]);
		watcher.close();

		expect(changes).toHaveLength(1);
		expect(changes[0]).toContain('modules/device/index.ts');
	});
});
