import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AbsoluteAndroidReleaseMetadata } from '../../src/mobile/androidRelease';
import {
	detectAbsoluteMobileHost,
	inspectAbsoluteMobileToolchain
} from '../../src/mobile/emulatorDoctor';

const ENABLED =
	process.env.ABSOLUTE_TEST_NATIVE_CAPACITOR_ANDROID_RELEASE === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const FIXTURE_ROOT = resolve(
	PROJECT_ROOT,
	'tests/fixtures/capacitor-android-release'
);
const REPORT_PATH = resolve(
	FIXTURE_ROOT,
	'.absolutejs/capacitor-android-release-conformance.json'
);
const TIMEOUT_MS = 45 * 60 * 1000;
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
	stdout: string;
};

const runCli = async (args: string[]) => {
	const child = Bun.spawn(
		[process.execPath, resolve(PROJECT_ROOT, 'src/cli/index.ts'), ...args],
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
			`absolute ${args.join(' ')} failed with status ${exitCode}.\n${stdout}\n${stderr}`
		);

	return { stderr, stdout };
};

const exists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const initialize = async () => {
	const nativeRoot = resolve(FIXTURE_ROOT, '.absolutejs/mobile/android');
	if (await exists(nativeRoot)) return;
	await runCli(['mobile', 'init', '--config', 'absolute.config.ts', '--yes']);
};

const gradleWork = (output: string): GradleWork => {
	const matches = [
		...output.matchAll(
			/(\d+) actionable tasks:\s*(?:(\d+) executed)?(?:,\s*)?(?:(\d+) up-to-date)?/gu
		)
	];
	const match = matches.at(-1);
	if (!match)
		throw new Error(
			'Capacitor Android release output did not include the Gradle task summary.'
		);

	return {
		executed: Number(match[2] ?? 0),
		total: Number(match[1]),
		upToDate: Number(match[3] ?? 0)
	};
};

const outputPath = (output: string, label: 'Artifact' | 'Metadata') => {
	const match = new RegExp(`^${label}: (.+)$`, 'mu').exec(output);
	if (!match?.[1])
		throw new Error(
			`Capacitor Android release output did not print ${label}.`
		);

	return match[1].trim();
};

const build = async (): Promise<CliBuild> => {
	const startedAt = performance.now();
	const { stdout } = await runCli([
		'mobile',
		'build',
		'android',
		'server.ts',
		'--config',
		'absolute.config.ts',
		'--outdir',
		'.absolutejs/releases',
		'--web-outdir',
		'.absolutejs/build',
		'--unsigned'
	]);
	for (const phase of RELEASE_PHASES)
		expect(stdout).toContain(
			`[mobile:android-release] ${phase} completed in `
		);
	const metadataPath = outputPath(stdout, 'Metadata');
	const metadata = JSON.parse(
		await readFile(metadataPath, 'utf8')
	) as AbsoluteAndroidReleaseMetadata;

	return {
		durationMs: Math.round(performance.now() - startedAt),
		gradle: gradleWork(stdout),
		metadata,
		metadataPath,
		stdout
	};
};

const installedAcceptance = async (metadataPath: string) => {
	const { stdout } = await runCli([
		'mobile',
		'test',
		'android',
		'--config',
		'absolute.config.ts',
		'--release',
		dirname(metadataPath),
		'--report',
		'.absolutejs/capacitor-android-release-installed',
		'--yes',
		'--json'
	]);

	return JSON.parse(stdout) as {
		durationMs: number;
		embeddedOffline: true;
		engine: 'capacitor';
		installMs: number;
		launchMs: number;
		relaunchMs: number;
		status: 'pass';
	};
};

const sha256 = async (path: string) =>
	createHash('sha256')
		.update(await readFile(path))
		.digest('hex');

const zipEntries = (artifactPath: string) => {
	const result = Bun.spawnSync(['unzip', '-Z1', artifactPath], {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());

	return result.stdout.toString().split(/\r?\n/u).filter(Boolean);
};

describeNative('real Capacitor Android production release conformance', () => {
	test(
		'builds and installs the public CLI release path with offline relaunch',
		async () => {
			const host = detectAbsoluteMobileHost();
			const checks = await inspectAbsoluteMobileToolchain({ host });
			for (const id of [
				'android.adb',
				'android.emulator',
				'android.java',
				'android.sdkmanager'
			] as const) {
				const check = checks.find((candidate) => candidate.id === id);
				if (!check?.path || check.status === 'fail')
					throw new Error(
						check?.remediation ??
							`Capacitor Android release acceptance requires ${id}.`
					);
			}
			await initialize();
			const initial = await build();
			const warm = await build();
			const artifactPath = outputPath(warm.stdout, 'Artifact');
			const artifactStat = await stat(artifactPath);
			expect(warm.metadata).toMatchObject({
				appId: 'com.absolutejs.capacitorreleaseacceptance',
				artifact: 'app-release.aab',
				bytes: artifactStat.size,
				engine: 'capacitor',
				format: 1,
				platform: 'android',
				signed: false,
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
			const entries = zipEntries(artifactPath);
			expect(entries).toContain('base/assets/public/index.html');
			expect(entries).toContain(
				'base/assets/public/absolute-mobile-manifest.json'
			);
			expect(entries).toContain(
				'base/assets/public/absolute-mobile-bootstrap.js'
			);
			const installed = await installedAcceptance(warm.metadataPath);
			expect(installed).toMatchObject({
				embeddedOffline: true,
				engine: 'capacitor',
				status: 'pass'
			});

			await writeFile(
				REPORT_PATH,
				`${JSON.stringify(
					{
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
							embeddedOffline: true,
							installMs: installed.installMs,
							launchMs: installed.launchMs,
							relaunchMs: installed.relaunchMs
						},
						phases: [...RELEASE_PHASES],
						warm: {
							durationMs: warm.durationMs,
							gradle: warm.gradle
						}
					},
					null,
					'\t'
				)}\n`
			);
			console.log(`Capacitor Android release report: ${REPORT_PATH}`);
		},
		TIMEOUT_MS
	);
});
