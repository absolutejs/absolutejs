import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { findFreePort } from '../../src/cli/utils';
import { readAbsoluteAndroidRelease } from '../../src/mobile/androidReleaseAcceptance';
import { inspectAbsoluteMobileToolchain } from '../../src/mobile/emulatorDoctor';
import { nativeCapture } from './androidLocalHttps';

/** Finish both native builds before starting the disposable emulator. */
export const buildAndroidProofReleases = async (
	root: string,
	output: string,
	origin: string,
	dependencies = {
		capture: nativeCapture,
		inspect: inspectAbsoluteMobileToolchain,
		port: findFreePort
	},
	engines: readonly ('capacitor' | 'expo')[] = ['capacitor', 'expo'],
	scenario: 'data' | 'authenticated' = 'data'
) => {
	const checks = await dependencies.inspect();
	const java = checks.find((check) => check.id === 'android.java');
	if (!java?.path || java.status === 'fail')
		throw new Error(java?.remediation ?? 'Missing Android JDK');
	const javaPath = java.path;
	const run = async (
		args: string[],
		cwd = root,
		env = process.env,
		timeout = 60_000
	) =>
		(await dependencies.capture(args, cwd, env, timeout)).toString().trim();
	const toolPath = async (path: string) =>
		process.platform !== 'win32' && javaPath.endsWith('.exe')
			? run(['wslpath', '-w', path])
			: path;
	const keytool = join(
		dirname(javaPath),
		javaPath.endsWith('.exe') ? 'keytool.exe' : 'keytool'
	);
	const keystore = join(output, 'synthetic-signing.p12');
	const password = randomUUID();
	const env: NodeJS.ProcessEnv = {
		...process.env,
		ABSOLUTE_ANDROID_KEY_ALIAS: 'synthetic',
		ABSOLUTE_ANDROID_KEY_PASSWORD: password,
		ABSOLUTE_ANDROID_KEYSTORE_PASSWORD: password,
		ABSOLUTE_ANDROID_KEYSTORE_PATH: keystore,
		ABSOLUTE_TEST_ANDROID_BRANDING: '0',
		ABSOLUTE_TEST_RELEASE_ORIGIN: origin,
		PORT: String(await dependencies.port()),
		TELEMETRY_OFF: '1',
		WSLENV: [
			process.env.WSLENV,
			'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD',
			'ABSOLUTE_ANDROID_KEY_PASSWORD'
		]
			.filter(Boolean)
			.join(':')
	};
	await run(
		[
			keytool,
			'-genkeypair',
			'-keystore',
			await toolPath(keystore),
			'-storetype',
			'PKCS12',
			'-storepass:env',
			'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD',
			'-keypass:env',
			'ABSOLUTE_ANDROID_KEY_PASSWORD',
			'-alias',
			'synthetic',
			'-keyalg',
			'RSA',
			'-validity',
			'30',
			'-dname',
			'CN=AbsoluteJS Synthetic Acceptance'
		],
		root,
		env
	);
	const certificate = await dependencies.capture(
		[
			keytool,
			'-exportcert',
			'-keystore',
			await toolPath(keystore),
			'-storepass:env',
			'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD',
			'-alias',
			'synthetic'
		],
		root,
		env
	);
	env.ABSOLUTE_TEST_RELEASE_CERTIFICATE_SHA256 = createHash('sha256')
		.update(certificate)
		.digest('hex');
	const releases = [];
	for (const engine of engines) {
		console.log(
			`[release-data] Building ${engine} before emulator startup`
		);
		const fixture = join(
			root,
			`tests/fixtures/${engine}-android-${scenario === 'authenticated' ? 'authenticated-' : ''}release`
		);
		const evidence = join(output, engine);
		await mkdir(evidence);
		const initialization = await run(
			[
				process.execPath,
				join(root, 'src/cli/index.ts'),
				'mobile',
				'init',
				...(engine === 'expo' ||
				existsSync(
					join(
						fixture,
						scenario === 'authenticated'
							? 'mobile/android'
							: '.absolutejs/mobile/android'
					)
				)
					? ['--no-native']
					: []),
				'--yes',
				'--config',
				'absolute.config.ts'
			],
			fixture,
			env,
			15 * 60 * 1000
		);
		await writeFile(join(evidence, 'initialization.log'), initialization);
		const build = await run(
			[
				process.execPath,
				join(root, 'src/cli/index.ts'),
				'mobile',
				'build',
				'android',
				'server.ts',
				'--config',
				'absolute.config.ts',
				'--outdir',
				'.absolutejs/releases',
				'--web-outdir',
				'.absolutejs/build'
			],
			fixture,
			env,
			60 * 60 * 1000
		);
		await writeFile(join(evidence, 'build.log'), build);
		const metadata = /^Metadata: (.+)$/mu.exec(build)?.[1]?.trim();
		if (!metadata) throw new Error('Release metadata missing');
		const release = await readAbsoluteAndroidRelease(
			fixture,
			dirname(metadata)
		);
		if (!release.metadata.signed) throw new Error('Release is not signed');
		// Raw server.ts has not received generated mobile identities/contracts.
		// Serve the backend produced by the same build as the embedded client.
		const serverEntry = join(fixture, '.absolutejs/build/server.js');
		const serverSha256 = createHash('sha256')
			.update(await readFile(serverEntry))
			.digest('hex');
		releases.push({
			engine,
			evidence,
			fixture,
			release,
			serverEntry,
			serverSha256
		});
	}
	await writeFile(
		join(output, 'builds-completed.json'),
		JSON.stringify(
			{
				completedAt: new Date().toISOString(),
				engines: releases.map(({ engine }) => engine)
			},
			null,
			2
		)
	);

	return { env, releases };
};
