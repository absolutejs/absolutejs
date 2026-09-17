import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { inspectAbsoluteMobileToolchain } from '../../src/mobile/emulatorDoctor';
import { readAbsoluteAndroidRelease } from '../../src/mobile/androidReleaseAcceptance';
import {
	brandingHasVisibleContent,
	brandingPixelDigest,
	writeBrandingFixture
} from '../helpers/mobileBranding';

const enabled = process.env.ABSOLUTE_TEST_ANDROID_BRANDING === '1';
const root = resolve(import.meta.dir, '../..');
const describeNative = enabled ? describe : describe.skip;
const timeout = 90 * 60 * 1000;

const capture = async (command: string[], cwd = root) => {
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, TELEMETRY_OFF: '1' },
		signal: AbortSignal.timeout(timeout),
		stderr: 'pipe',
		stdin: 'ignore',
		stdout: 'pipe'
	});
	const [code, bytes, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).text()
	]);

	return {
		bytes: Buffer.from(bytes),
		code,
		stderr,
		stdout: Buffer.from(bytes).toString()
	};
};

const run = async (command: string[], cwd = root) => {
	const result = await capture(command, cwd);
	if (result.code !== 0)
		throw new Error(
			`${command.join(' ')} failed (${result.code}):\n${result.stdout}\n${result.stderr}`
		);

	return result;
};

const cli = (fixture: string, args: string[]) => {
	console.log(`[branding] mobile ${args.slice(0, 2).join(' ')}`);

	return run(
		[process.execPath, join(root, 'src/cli/index.ts'), 'mobile', ...args],
		fixture
	);
};

const packagedBranding = async (artifact: string, nativeRoot: string) => {
	const entries = (await run(['unzip', '-Z1', artifact])).stdout.split(
		/\r?\n/u
	);
	const images = entries.filter((entry) =>
		/^base\/res\/(?:mipmap|drawable)[^/]*\/(?:ic_launcher[^/]*|splash[^/]*)\.(?:png|webp)$/u.test(
			entry
		)
	);
	expect(images.length).toBeGreaterThan(5);
	expect(
		images.some((entry) => entry.includes('ic_launcher_foreground'))
	).toBe(true);
	expect(
		images.some((entry) => entry.includes('ic_launcher_monochrome'))
	).toBe(true);
	expect(
		images.some(
			(entry) => entry.includes('night') && entry.includes('splash')
		)
	).toBe(true);
	const digests: Record<string, string> = {};
	for (const entry of images) {
		const relative = entry
			.replace('base/res/', '')
			.replace(/-v\d+(?=\/)/u, '');
		const source = await readFile(
			join(nativeRoot, 'app/src/main/res', relative)
		);
		const packed = (await run(['unzip', '-p', artifact, entry])).bytes;
		const digest = await brandingPixelDigest(packed);
		expect(digest).toBe(await brandingPixelDigest(source));
		digests[entry] = digest;
	}
	const resources = join(nativeRoot, 'app/src/main/res');
	const adaptive = await readFile(
		join(resources, 'mipmap-anydpi-v26/ic_launcher.xml'),
		'utf8'
	);
	expect(adaptive).toContain('<foreground');
	expect(adaptive).toContain('<monochrome');

	return digests;
};

const screenshots = async (adb: string, appId: string, output: string) => {
	const devices = (await run([adb, 'devices'])).stdout
		.split(/\r?\n/u)
		.map((line) => /^(emulator-\d+)\s+device$/u.exec(line)?.[1])
		.filter((value): value is string => Boolean(value));
	if (devices.length !== 1)
		throw new Error(
			'Branding capture requires exactly one connected emulator; physical devices are never selected.'
		);
	const [serial] = devices;
	if (!serial) throw new Error('No emulator is connected.');
	const shell = (...args: string[]) =>
		run([adb, '-s', serial, 'shell', ...args]);
	const sdk = Number(
		(await shell('getprop', 'ro.build.version.sdk')).stdout.trim()
	);
	if (sdk < 33)
		throw new Error(
			'Branding capture requires Android API 33+ for themed icons.'
		);
	const original = /Night mode: (auto|no|yes)\s*$/u.exec(
		(await shell('cmd', 'uimode', 'night')).stdout
	)?.[1];
	if (!original)
		throw new Error('Cannot preserve emulator night-mode setting.');
	const files: string[] = [];
	const screenshot = async (name: string) => {
		const started = performance.now();
		const requireVisible =
			name.endsWith('-launcher.png') || name.endsWith('-launched.png');
		const captureVisible = async (): Promise<Buffer> => {
			const { bytes } = await run([
				adb,
				'-s',
				serial,
				'exec-out',
				'screencap',
				'-p'
			]);
			if (
				!requireVisible ||
				(await brandingHasVisibleContent(bytes)) ||
				performance.now() - started >= 10_000
			)
				return bytes;
			await Bun.sleep(250);

			return captureVisible();
		};
		const bytes = await captureVisible();
		expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		await writeFile(join(output, name), bytes);
		if (requireVisible)
			expect(await brandingHasVisibleContent(bytes)).toBe(true);
		files.push(name);
	};
	try {
		for (const [appearance, mode] of [
			['light', 'no'],
			['dark', 'yes']
		] as const) {
			await shell('input', 'keyevent', 'KEYCODE_WAKEUP');
			await shell('wm', 'dismiss-keyguard');
			await shell('cmd', 'uimode', 'night', mode);
			await shell('am', 'force-stop', appId);
			await shell('input', 'keyevent', 'KEYCODE_HOME');
			await Bun.sleep(500);
			await screenshot(`${appearance}-launcher.png`);
			const launch = shell(
				'am',
				'start',
				'-W',
				'-n',
				`${appId}/.MainActivity`
			);
			const captureFrames = async () => {
				for (let frame = 0; frame < 4; frame++)
					await screenshot(`${appearance}-launch-${frame}.png`);
			};
			await Promise.all([launch, captureFrames()]);
			await screenshot(`${appearance}-launched.png`);
		}
	} finally {
		await shell('cmd', 'uimode', 'night', original);
		await shell('am', 'force-stop', appId);
	}

	return {
		api: sdk,
		files,
		splashVisibility: 'not-asserted',
		themedLauncherAppearance: 'not-asserted',
		visualReview: 'required'
	};
};

describeNative('installed Android branding conformance', () => {
	for (const engine of ['capacitor', 'expo'] as const) {
		test(
			`${engine}: packages and installs refreshed artwork with light/dark capture`,
			async () => {
				const fixture = join(
					root,
					`tests/fixtures/${engine}-android-release`
				);
				const output = join(
					fixture,
					'.absolutejs/branding-conformance'
				);
				await mkdir(output, { recursive: true });
				const reportPath = join(output, 'report.json');
				const report: Record<string, unknown> = {
					absolutejsVersion: JSON.parse(
						await readFile(join(root, 'package.json'), 'utf8')
					).version,
					engine,
					format: 1,
					revisions: [],
					startedAt: new Date().toISOString(),
					status: 'running'
				};
				const save = () =>
					writeFile(
						reportPath,
						`${JSON.stringify(report, null, '\t')}\n`
					);
				await save();
				try {
					const checks = await inspectAbsoluteMobileToolchain();
					const adb = checks.find(
						(check) => check.id === 'android.adb'
					)?.path;
					if (!adb)
						throw new Error(
							'Android branding conformance requires the managed Android toolchain.'
						);
					let previous: Record<string, string> | undefined;
					let previousFingerprint: string | undefined;
					for (const revision of [1, 2]) {
						console.log(
							`[branding:${engine}] revision ${revision}: generate, build, install, capture`
						);
						await writeBrandingFixture(fixture, revision);
						if (revision === 2) {
							const stale = await capture(
								[
									process.execPath,
									join(root, 'src/cli/index.ts'),
									'mobile',
									'assets',
									'--check',
									'--json'
								],
								fixture
							);
							expect(stale.code).not.toBe(0);
							expect(JSON.parse(stale.stdout).status).toBe(
								'stale'
							);
						}
						if (
							engine === 'capacitor' &&
							!(await Bun.file(
								join(
									fixture,
									'.absolutejs/mobile/android/app/build.gradle'
								)
							).exists())
						)
							await cli(fixture, ['init', '--yes']);
						await cli(fixture, ['assets', 'android', '--yes']);
						const checked = JSON.parse(
							(
								await cli(fixture, [
									'assets',
									'--check',
									'--json'
								])
							).stdout
						);
						expect(checked.ready).toBe(true);
						const manifest = JSON.parse(
							await readFile(
								join(
									fixture,
									'.absolutejs/mobile/branding/manifest.json'
								),
								'utf8'
							)
						);
						if (previousFingerprint)
							expect(manifest.fingerprint).not.toBe(
								previousFingerprint
							);
						previousFingerprint = manifest.fingerprint;
						const build = await cli(fixture, [
							'build',
							'android',
							'server.ts',
							'--outdir',
							'.absolutejs/releases',
							'--web-outdir',
							'.absolutejs/build',
							...(engine === 'capacitor' ? ['--unsigned'] : [])
						]);
						const metadataPath = /^Metadata: (.+)$/mu
							.exec(build.stdout)?.[1]
							?.trim();
						if (!metadataPath)
							throw new Error(
								'Release build did not print its metadata path.'
							);
						const release = await readAbsoluteAndroidRelease(
							fixture,
							dirname(metadataPath)
						);
						const nativeRoot = join(
							fixture,
							'.absolutejs/mobile',
							engine === 'expo' ? 'expo/android' : 'android'
						);
						const pixels = await packagedBranding(
							release.artifactPath,
							nativeRoot
						);
						if (previous) {
							const priorPixels = previous;
							for (const kind of [
								'ic_launcher.',
								'ic_launcher_foreground.',
								'splash'
							])
								expect(
									Object.keys(pixels).some(
										(entry) =>
											entry.includes(kind) &&
											priorPixels[entry] &&
											priorPixels[entry] !== pixels[entry]
									)
								).toBe(true);
						}
						previous = pixels;
						const installed = JSON.parse(
							(
								await cli(fixture, [
									'test',
									'android',
									'--release',
									release.releaseRoot,
									'--report',
									`.absolutejs/branding-conformance/installed-${revision}`,
									'--yes',
									'--json'
								])
							).stdout
						);
						expect(installed).toMatchObject({
							artifactSha256: release.metadata.sha256,
							embeddedOffline: true,
							engine,
							status: 'pass'
						});
						const captureRoot = join(
							output,
							`revision-${revision}`
						);
						await mkdir(captureRoot, { recursive: true });
						const evidence = await screenshots(
							adb,
							release.metadata.appId,
							captureRoot
						);
						(report.revisions as unknown[]).push({
							artifactSha256: release.metadata.sha256,
							fingerprint: manifest.fingerprint,
							installed,
							packagedPixels: pixels,
							releaseId: release.metadata.releaseId,
							revision,
							screenshots: evidence,
							sourceChangeRejected: revision === 2
						});
						await save();
					}
					report.status = 'pass';
				} catch (error) {
					report.status = 'fail';
					throw error;
				} finally {
					report.finishedAt = new Date().toISOString();
					await save();
					console.log(`Android branding report: ${reportPath}`);
				}
			},
			timeout
		);
	}
});
