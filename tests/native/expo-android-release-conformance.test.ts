import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AbsoluteAndroidReleaseMetadata } from '../../src/mobile/androidRelease';
import {
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from '../../src/mobile/emulatorDoctor';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_EXPO_ANDROID_RELEASE === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(
	PROJECT_ROOT,
	'tests/fixtures/expo-android-release'
);
const REPORT_PATH = resolve(
	FIXTURE_ROOT,
	'.absolutejs/expo-android-release-conformance.json'
);
const TIMEOUT_MS = 60 * 60 * 1000;
const PRODUCTION_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'] as const;
const RELEASE_PHASES = [
	'bundle',
	'native-project',
	'release-doctor',
	'native-build'
] as const;

type GradleWork = {
	executed: number;
	total: number;
	upToDate: number;
};

type CliBuild = {
	durationMs: number;
	gradle: GradleWork;
	metadata: AbsoluteAndroidReleaseMetadata;
	metadataPath: string;
	stderr: string;
	stdout: string;
};

type BuildReport = {
	durationMs: number;
	gradle: GradleWork;
};

type ArtifactReport = {
	bytes: number;
	releaseId: string;
	sha256: string;
	signed: boolean;
};

type ExpoAndroidReleaseConformanceReport = {
	abis: string[];
	artifact: ArtifactReport;
	format: 1;
	host: 'wsl';
	initial: BuildReport;
	installed: {
		durationMs: number;
		embeddedOffline: true;
		installMs: number;
		launchMs: number;
		relaunchMs: number;
	};
	phases: string[];
	warm: BuildReport;
};

const installedAcceptance = async (metadataPath: string) => {
	const reportRoot = resolve(
		FIXTURE_ROOT,
		'.absolutejs/expo-android-release-installed'
	);
	const child = Bun.spawn(
		[
			process.execPath,
			resolve(PROJECT_ROOT, 'src/cli/index.ts'),
			'mobile',
			'test',
			'android',
			'--config',
			'absolute.config.ts',
			'--release',
			dirname(metadataPath),
			'--report',
			reportRoot,
			'--yes',
			'--json'
		],
		{
			cwd: FIXTURE_ROOT,
			env: { ...process.env, TELEMETRY_OFF: '1' },
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		}
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);
	if (exitCode !== 0)
		throw new Error(
			`absolute mobile test android --release failed with status ${exitCode}.\n${stdout}\n${stderr}`
		);

	return JSON.parse(stdout) as {
		durationMs: number;
		embeddedOffline: true;
		installMs: number;
		launchMs: number;
		relaunchMs: number;
	};
};

const capture = (command: string[]) => {
	const result = Bun.spawnSync(command, {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`${command.join(' ')} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`
		);
	}

	return result.stdout.toString();
};

const gradleWork = (output: string): GradleWork => {
	const matches = [
		...output.matchAll(
			/(\d+) actionable tasks:\s*(?:(\d+) executed)?(?:,\s*)?(?:(\d+) up-to-date)?/gu
		)
	];
	const match = matches.at(-1);
	if (!match) {
		throw new Error(
			'Expo Android release output did not include the Gradle task summary.'
		);
	}

	return {
		executed: Number(match[2] ?? 0),
		total: Number(match[1]),
		upToDate: Number(match[3] ?? 0)
	};
};

const outputPath = (output: string, label: 'Artifact' | 'Metadata') => {
	const match = new RegExp(`^${label}: (.+)$`, 'mu').exec(output);
	if (!match?.[1])
		throw new Error(`Expo Android release output did not print ${label}.`);

	return match[1].trim();
};

const assertPhaseLogs = (output: string) => {
	for (const phase of RELEASE_PHASES) {
		expect(output).toContain(
			`[mobile:android-release] ${phase} completed in `
		);
	}
};

const build = async (): Promise<CliBuild> => {
	const startedAt = performance.now();
	const child = Bun.spawn(
		[
			process.execPath,
			resolve(PROJECT_ROOT, 'src/cli/index.ts'),
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
		{
			cwd: FIXTURE_ROOT,
			env: {
				...process.env,
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		}
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);
	if (exitCode !== 0) {
		throw new Error(
			`absolute mobile build android failed with status ${exitCode}.\n${stdout}\n${stderr}`
		);
	}
	assertPhaseLogs(stdout);
	const metadataPath = outputPath(stdout, 'Metadata');
	const metadata = JSON.parse(
		await readFile(metadataPath, 'utf8')
	) as AbsoluteAndroidReleaseMetadata;

	return {
		durationMs: Math.round(performance.now() - startedAt),
		gradle: gradleWork(stdout),
		metadata,
		metadataPath,
		stderr,
		stdout
	};
};

const sha256 = async (path: string) =>
	createHash('sha256')
		.update(await readFile(path))
		.digest('hex');

describeNative('real Expo Android WSL production release conformance', () => {
	test(
		'builds the public CLI release path and reuses its Windows-local caches',
		async () => {
			const host = detectAbsoluteMobileHost();
			if (host !== 'wsl') {
				throw new Error(
					`Expo Android WSL release acceptance requires WSL, received ${host}.`
				);
			}
			expect(host).toBe('wsl');
			for (const executable of ['powershell.exe', 'unzip', 'wslpath']) {
				if (!Bun.which(executable)) {
					throw new Error(
						`Expo Android WSL release acceptance requires ${executable}.`
					);
				}
			}
			const checks = await inspectAbsoluteMobileToolchain({ host });
			for (const id of ['android.java', 'android.sdkmanager'] as const) {
				const check = checks.find((candidate) => candidate.id === id);
				if (!check?.path || check.status === 'fail') {
					throw new Error(
						check?.remediation ??
							`Expo Android WSL release acceptance requires ${id}.`
					);
				}
			}

			const initial = await build();
			const warm = await build();
			const artifactPath = outputPath(warm.stdout, 'Artifact');
			const artifactStat = await stat(artifactPath);
			expect(warm.metadata).toMatchObject({
				appId: 'com.absolutejs.exporeleaseacceptance',
				artifact: 'app-release.aab',
				bytes: artifactStat.size,
				engine: 'expo',
				format: 1,
				platform: 'android',
				signed: true,
				type: 'aab'
			});
			expect(warm.metadata.sha256).toBe(await sha256(artifactPath));
			expect(warm.metadata.releaseId).toBe(
				`amobile_android_${warm.metadata.sha256}`
			);
			expect(warm.metadata.appBuild).toBe(initial.metadata.appBuild);
			expect(warm.metadata.runtime).toBe(initial.metadata.runtime);
			expect(warm.gradle.upToDate).toBeGreaterThan(0);
			expect(warm.gradle.executed).toBeLessThan(warm.gradle.total);
			expect(warm.durationMs).toBeLessThan(15 * 60 * 1000);

			const entries = capture(['unzip', '-Z1', artifactPath])
				.split(/\r?\n/u)
				.filter(Boolean);
			for (const abi of PRODUCTION_ABIS) {
				expect(
					entries.some((entry) =>
						entry.startsWith(`base/lib/${abi}/`)
					)
				).toBe(true);
			}
			expect(
				entries.some((entry) =>
					entry.endsWith('/assets/index.android.bundle')
				)
			).toBe(true);
			const installed = await installedAcceptance(warm.metadataPath);
			expect(installed).toMatchObject({
				embeddedOffline: true,
				engine: 'expo',
				status: 'pass'
			});

			const nativeRoot = resolve(FIXTURE_ROOT, '.absolutejs/mobile/expo');
			const [appConfig, androidManifest] = await Promise.all([
				readFile(resolve(nativeRoot, 'app.json'), 'utf8'),
				readFile(
					resolve(
						nativeRoot,
						'android/app/src/main/AndroidManifest.xml'
					),
					'utf8'
				)
			]);
			expect(appConfig).not.toContain('withAbsoluteDevelopmentCa');
			expect(androidManifest).not.toContain(
				'absolutejs_dev_network_security'
			);
			expect(androidManifest).not.toContain(
				'usesCleartextTraffic="true"'
			);

			const report: ExpoAndroidReleaseConformanceReport = {
				abis: [...PRODUCTION_ABIS],
				artifact: {
					bytes: warm.metadata.bytes,
					releaseId: warm.metadata.releaseId,
					sha256: warm.metadata.sha256,
					signed: warm.metadata.signed
				},
				format: 1,
				host,
				initial: {
					durationMs: initial.durationMs,
					gradle: initial.gradle
				},
				installed: {
					durationMs: installed.durationMs,
					embeddedOffline: installed.embeddedOffline,
					installMs: installed.installMs,
					launchMs: installed.launchMs,
					relaunchMs: installed.relaunchMs
				},
				phases: [...RELEASE_PHASES],
				warm: {
					durationMs: warm.durationMs,
					gradle: warm.gradle
				}
			};
			await writeFile(
				REPORT_PATH,
				`${JSON.stringify(report, null, '\t')}\n`
			);
			console.log(`Expo Android WSL release report: ${REPORT_PATH}`);
		},
		TIMEOUT_MS
	);
});
