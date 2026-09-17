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

const runCli = async (
	cwd: string,
	args: string[],
	env: Record<string, string | undefined> = process.env
) => {
	const subprocess = Bun.spawn(
		[process.execPath, resolve(ROOT, 'src/cli/index.ts'), ...args],
		{ cwd, env, stderr: 'pipe', stdin: 'ignore', stdout: 'pipe' }
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

		await Promise.all([
			writeFile(
				join(root, 'absolute.config.ts'),
				`export default ${JSON.stringify({
					mobile: {
						appId: 'com.example.certification',
						appName: 'Certification',
						server: {
							productionOrigin: 'https://example.com'
						}
					}
				})};\n`
			),
			writeFile(
				join(root, 'registry.ts'),
				`export default {
	async publish(options: Record<string, any>) {
		await Bun.write('publication.json', JSON.stringify(options));
		const metadata = await Bun.file(options.releaseRoot + '/release.json').json();
		return {
			certification: {
				certificationId: options.certification.certificationId,
				releaseId: metadata.releaseId,
				requirement: options.certificationRequirement,
				strength: options.certification.strength
			},
			channel: { channel: options.channel, releaseId: metadata.releaseId },
			record: { metadata }, reused: false
		};
	}
};\n`
			)
		]);
		const bin = join(root, 'bin');
		await mkdir(bin);
		await writeFile(join(bin, 'gh'), '#!/bin/sh\nexit 7\n', {
			mode: 0o700
		});
		const interruptedPromotion = await runCli(
			root,
			[
				'mobile',
				'ci',
				'promote',
				'android',
				'--run-id',
				'1234',
				'--certification',
				certificationDirectory,
				'--channel',
				'production'
			],
			{ ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
		);
		expect(interruptedPromotion.exitCode).not.toBe(0);
		expect(interruptedPromotion.stderr).toContain(
			'Resume without redispatching: absolute mobile ci promote --resume amp_'
		);
		const promotions = await runCli(root, [
			'mobile',
			'ci',
			'promotions',
			'--json'
		]);
		expect(promotions.exitCode).toBe(0);
		const [record] = JSON.parse(promotions.stdout);
		expect(record).toMatchObject({
			certificationId: certification.certificationId,
			phase: 'dispatching',
			releaseId,
			sourceRunId: '1234'
		});
		const recordSource = await Bun.file(
			join(
				root,
				'.absolutejs/mobile-ci/promotions',
				record.dispatchId,
				'operation.json'
			)
		).text();
		expect(recordSource).not.toContain('certification_base64');
		expect(recordSource).not.toContain('signed-aab-fixture');
		const gated = await runCli(root, [
			'mobile',
			'publish',
			'android',
			'--release',
			'release',
			'--certification',
			certificationDirectory,
			'--channel',
			'production',
			'--registry',
			'registry.ts'
		]);
		expect(gated.exitCode).toBe(0);
		expect(gated.stdout).toContain(
			`Published Android release ${releaseId}`
		);
		expect(
			JSON.parse(await Bun.file(join(root, 'publication.json')).text())
		).toMatchObject({
			certification: { certificationId: certification.certificationId },
			certificationRequirement: 'installed',
			releaseRoot
		});
		const missingCertification = await runCli(root, [
			'mobile',
			'publish',
			'android',
			'--release',
			'release',
			'--channel',
			'production',
			'--registry',
			'registry.ts'
		]);
		expect(missingCertification.exitCode).not.toBe(0);
		expect(missingCertification.stderr).toContain(
			'requires --certification with installed evidence'
		);

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
	}, 15_000);
});
