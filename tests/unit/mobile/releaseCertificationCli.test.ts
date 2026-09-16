import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	createAbsoluteNativeTestReport,
	writeAbsoluteNativeTestReport
} from '../../../src/mobile/nativeTestReport';

const ROOT = resolve(import.meta.dir, '..', '..', '..');

const runCli = async (cwd: string, args: string[]) => {
	const subprocess = Bun.spawn(
		[process.execPath, resolve(ROOT, 'src/cli/index.ts'), ...args],
		{ cwd, stderr: 'pipe', stdin: 'ignore', stdout: 'pipe' }
	);
	const [exitCode, stderr, stdout] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stderr).text(),
		new Response(subprocess.stdout).text()
	]);

	return { exitCode, stderr, stdout };
};

describe('mobile certify CLI', () => {
	test('creates and verifies a content-addressed Android certification without loading app config', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-certify-cli-'));
		const releaseRoot = join(root, 'release');
		await mkdir(releaseRoot, { recursive: true });
		const artifact = Buffer.from('signed-aab-fixture');
		const digest = createHash('sha256').update(artifact).digest('hex');
		const releaseId = `amobile_android_${digest}`;
		await Promise.all([
			writeFile(join(releaseRoot, 'app-release.aab'), artifact),
			writeFile(
				join(releaseRoot, 'release.json'),
				`${JSON.stringify(
					{
						appBuild: 'web-build',
						appId: 'com.example.certification',
						artifact: 'app-release.aab',
						bytes: artifact.byteLength,
						engine: 'capacitor',
						format: 1,
						platform: 'android',
						releaseId,
						runtime: 'runtime-fingerprint',
						sha256: digest,
						signed: true,
						type: 'aab',
						versionCode: 9
					},
					null,
					2
				)}\n`
			)
		]);
		await writeAbsoluteNativeTestReport(
			join(root, 'report'),
			createAbsoluteNativeTestReport({
				generatedAt: '2026-09-16T12:00:00.000Z',
				manualChecks: [],
				metadata: {
					absolutejsVersion: '0.20.0-beta.107',
					bunVersion: '1.4.0',
					provider: 'capacitor'
				},
				run: {
					appId: 'com.example.certification',
					durationMs: 100,
					hmrConnected: false,
					platform: 'android',
					release: {
						apksBytes: 100,
						artifactBytes: artifact.byteLength,
						artifactSha256: digest,
						embeddedOffline: true,
						engine: 'capacitor',
						installMs: 10,
						launchMs: 20,
						relaunchMs: 20,
						releaseId,
						signed: true
					},
					status: 'pass',
					targetId: 'android-emulator',
					targetKind: 'emulator'
				}
			})
		);

		const created = await runCli(root, [
			'mobile',
			'certify',
			'release',
			'--evidence',
			'report',
			'--require',
			'installed',
			'--outdir',
			'certifications',
			'--json'
		]);
		expect(created.exitCode).toBe(0);
		const certification = JSON.parse(created.stdout);
		expect(certification).toMatchObject({
			requirement: 'installed',
			status: 'certified',
			strength: 'installed'
		});
		const certificationDirectory = join(
			'certifications',
			certification.certificationId
		);
		const verified = await runCli(root, [
			'mobile',
			'certify',
			'release',
			'--verify',
			certificationDirectory,
			'--require',
			'installed',
			'--json'
		]);

		expect(verified.exitCode).toBe(0);
		expect(JSON.parse(verified.stdout).certificationId).toBe(
			certification.certificationId
		);
		expect(created.stderr).not.toContain(root);

		const missingRequirement = await runCli(root, [
			'mobile',
			'certify',
			'release',
			'--require'
		]);
		expect(missingRequirement.exitCode).not.toBe(0);
		expect(missingRequirement.stderr).toContain(
			'mobile certify --require requires a value.'
		);

		const missingOutput = await runCli(root, [
			'mobile',
			'certify',
			'release',
			'--evidence',
			'report',
			'--outdir'
		]);
		expect(missingOutput.exitCode).not.toBe(0);
		expect(missingOutput.stderr).toContain(
			'mobile certify --outdir requires a value.'
		);
	});
});
