import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAndroidProofReleases } from '../helpers/buildAndroidProofReleases';

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { force: true, recursive: true });
});

const fixture = async (failExpo = false) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-proof-builds-'));
	directories.push(root);
	const output = join(root, 'evidence');
	await mkdir(output);
	const commands: string[][] = [];
	const dependencies: Parameters<typeof buildAndroidProofReleases>[3] = {
		capture: async (command, cwd) => {
			commands.push(command);
			if (command.includes('-genkeypair')) return Buffer.from('');
			if (!cwd) throw new Error('Missing fixture cwd');
			const engine = cwd.includes('capacitor-android-')
				? 'capacitor'
				: 'expo';
			if (engine === 'expo' && failExpo)
				throw new Error('Synthetic Expo build failure');
			const release = join(cwd, '.absolutejs/releases/test');
			await mkdir(release, { recursive: true });
			await mkdir(join(cwd, '.absolutejs/build'), { recursive: true });
			await writeFile(
				join(cwd, '.absolutejs/build/server.js'),
				`export const engine = ${JSON.stringify(engine)};`
			);
			const artifact = Buffer.from(`signed-${engine}`);
			const sha256 = createHash('sha256').update(artifact).digest('hex');
			await writeFile(join(release, 'app-release.aab'), artifact);
			await writeFile(
				join(release, 'release.json'),
				JSON.stringify({
					appBuild: 'test',
					appId: `com.absolutejs.${engine}`,
					artifact: 'app-release.aab',
					bytes: artifact.byteLength,
					engine,
					format: 1,
					platform: 'android',
					releaseId: `amobile_android_${sha256}`,
					runtime: 'test',
					sha256,
					signed: true,
					type: 'aab'
				})
			);

			return Buffer.from(`Metadata: ${join(release, 'release.json')}`);
		},
		inspect: async () => [
			{
				id: 'android.java',
				label: 'Java',
				path: '/synthetic/bin/java',
				platform: 'android',
				status: 'pass'
			}
		],
		port: async () => 41000
	};

	return { commands, dependencies, output, root };
};

test('prepares both validated artifacts without invoking emulator or ADB commands', async () => {
	const { commands, dependencies, output, root } = await fixture();
	const { releases } = await buildAndroidProofReleases(
		root,
		output,
		'https://localhost:48443',
		dependencies
	);
	expect(releases.map(({ engine }) => engine)).toEqual(['capacitor', 'expo']);
	for (const release of releases) {
		expect(release.serverEntry).toBe(
			join(release.fixture, '.absolutejs/build/server.js')
		);
		expect(release.serverSha256).toBe(
			createHash('sha256')
				.update(await readFile(release.serverEntry))
				.digest('hex')
		);
	}
	expect(commands).toHaveLength(3);
	expect(commands[0]?.[0]).toBe('/synthetic/bin/keytool');
	for (const command of commands.slice(1))
		expect(command.slice(2, 5)).toEqual(['mobile', 'build', 'android']);
	expect(
		JSON.parse(
			await readFile(join(output, 'builds-completed.json'), 'utf8')
		).engines
	).toEqual(['capacitor', 'expo']);
});

test('builds separate authenticated fixtures without changing anonymous fixture selection', async () => {
	const { dependencies, output, root } = await fixture();
	const { releases } = await buildAndroidProofReleases(
		root,
		output,
		'https://localhost:48443',
		dependencies,
		['capacitor', 'expo'],
		'authenticated'
	);
	expect(releases.map((item) => item.fixture)).toEqual([
		join(root, 'tests/fixtures/capacitor-android-authenticated-release'),
		join(root, 'tests/fixtures/expo-android-authenticated-release')
	]);
});

test('does not declare the build phase complete when the second engine fails', async () => {
	const { dependencies, output, root } = await fixture(true);
	await expect(
		buildAndroidProofReleases(
			root,
			output,
			'https://localhost:48443',
			dependencies
		)
	).rejects.toThrow('Synthetic Expo build failure');
	await expect(
		readFile(join(output, 'builds-completed.json'))
	).rejects.toThrow();
});
