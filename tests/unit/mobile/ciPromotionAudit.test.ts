import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	auditAbsoluteMobileCiPromotion,
	parseAbsoluteMobileCiRunStatus,
	type AbsoluteMobileCiCommandRunner
} from '../../../src/mobile/ciPromotionAudit';
import { createAbsoluteMobileCertificationVerification } from '../../../src/mobile/certificationVerification';
import {
	createAbsoluteMobileReleaseCertification,
	writeAbsoluteMobileReleaseCertification
} from '../../../src/mobile/releaseCertification';
import {
	createAbsoluteNativeTestReport,
	writeAbsoluteNativeTestReport
} from '../../../src/mobile/nativeTestReport';

const roots: string[] = [];
const PROMOTION_RUN_ID = '2002';
const SOURCE_RUN_ID = '1001';

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const githubStatus: () => unknown = () => ({
	conclusion: 'success',
	createdAt: '2026-09-17T12:00:00Z',
	databaseId: Number(PROMOTION_RUN_ID),
	headBranch: 'main',
	headSha: 'a'.repeat(40),
	jobs: [
		{
			conclusion: 'success',
			name: 'Promote exact certified Android release',
			status: 'completed'
		}
	],
	startedAt: '2026-09-17T12:00:01Z',
	status: 'completed',
	updatedAt: '2026-09-17T12:01:00Z',
	url: `https://github.com/absolutejs/example/actions/runs/${PROMOTION_RUN_ID}`,
	workflowName: 'AbsoluteJS Mobile'
});

const fixture = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-promotion-audit-'));
	roots.push(root);
	const sourceArtifact = join(root, 'remote-source');
	const releaseRoot = join(sourceArtifact, 'release');
	await mkdir(releaseRoot, { recursive: true });
	const artifact = new TextEncoder().encode('signed android app bundle');
	const sha256 = createHash('sha256').update(artifact).digest('hex');
	const metadata: {
		appBuild: string;
		appId: string;
		artifact: string;
		bytes: number;
		engine: 'capacitor';
		format: 1;
		platform: 'android';
		releaseId: string;
		runtime: string;
		sha256: string;
		signed: boolean;
		type: 'aab';
		versionCode: number;
	} = {
		appBuild: 'ambuild_audit',
		appId: 'com.example.audit',
		artifact: 'app-release.aab',
		bytes: artifact.byteLength,
		engine: 'capacitor' as const,
		format: 1 as const,
		platform: 'android' as const,
		releaseId: `amobile_android_${sha256}`,
		runtime: 'runtime-audit',
		sha256,
		signed: true,
		type: 'aab' as const,
		versionCode: 12
	};
	await Promise.all([
		writeFile(join(releaseRoot, metadata.artifact), artifact),
		writeFile(
			join(releaseRoot, 'release.json'),
			`${JSON.stringify(metadata, null, 2)}\n`
		)
	]);
	const evidence = join(root, 'installed-evidence');
	await writeAbsoluteNativeTestReport(
		evidence,
		createAbsoluteNativeTestReport({
			generatedAt: '2026-09-17T11:30:00.000Z',
			manualChecks: [],
			metadata: {
				absolutejsVersion: '0.20.0-beta.110',
				bunVersion: '1.4.0',
				provider: 'capacitor'
			},
			run: {
				appId: metadata.appId,
				durationMs: 100,
				hmrConnected: false,
				platform: 'android',
				release: {
					apksBytes: metadata.bytes,
					artifactBytes: metadata.bytes,
					artifactSha256: metadata.sha256,
					embeddedOffline: true,
					engine: metadata.engine,
					installMs: 20,
					launchMs: 30,
					relaunchMs: 20,
					releaseId: metadata.releaseId,
					signed: true
				},
				status: 'pass',
				targetId: 'emulator',
				targetKind: 'emulator'
			}
		})
	);
	const certification = await createAbsoluteMobileReleaseCertification({
		evidencePaths: [evidence],
		projectRoot: root,
		release: { metadata },
		requirement: 'installed'
	});
	const promotionArtifact = join(root, 'remote-promotion');
	const imported = join(promotionArtifact, 'imported-certification');
	await mkdir(imported, { recursive: true });
	const certificationPaths = await writeAbsoluteMobileReleaseCertification(
		root,
		certification,
		imported
	);
	const bundle: Record<string, unknown> = {
		mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.3'
	};
	await writeFile(
		`${certificationPaths.jsonPath}.sigstore.json`,
		`${JSON.stringify(bundle, null, 2)}\n`
	);
	const verification = createAbsoluteMobileCertificationVerification(bundle, {
		GITHUB_REF: 'refs/heads/main',
		GITHUB_REPOSITORY: 'absolutejs/example',
		GITHUB_SHA: 'a'.repeat(40),
		GITHUB_WORKFLOW_REF:
			'absolutejs/example/.github/workflows/absolute-mobile.yml@refs/heads/main'
	});
	await Promise.all([
		writeFile(
			join(certificationPaths.directory, 'verification.json'),
			`${JSON.stringify(verification, null, 2)}\n`
		),
		writeFile(
			join(promotionArtifact, 'promotion-context.json'),
			`${JSON.stringify(
				{
					format: 1,
					platform: 'android',
					promotionRunId: PROMOTION_RUN_ID,
					sourceArtifact: 'absolute-mobile-android',
					sourceRunId: SOURCE_RUN_ID
				},
				null,
				2
			)}\n`
		),
		writeFile(
			join(promotionArtifact, 'promotion-receipt.json'),
			`${JSON.stringify(
				{
					certification: {
						certificationId: certification.certificationId,
						provenance: {
							issuer: verification.identity.issuer,
							subject: metadata.releaseId,
							verificationId: 'bundle-id',
							verifiedAt: '2026-09-17T12:00:30Z'
						},
						releaseId: metadata.releaseId,
						requirement: certification.requirement,
						strength: certification.strength
					},
					channel: {
						channel: 'production',
						releaseId: metadata.releaseId
					},
					record: { metadata },
					reused: false
				},
				null,
				2
			)}\n`
		)
	]);

	return { promotionArtifact, root, sourceArtifact };
};

const fixtureRunner = (
	promotionArtifact: string,
	sourceArtifact: string,
	commands: string[][] = []
) => {
	const runner: AbsoluteMobileCiCommandRunner = async (command, options) => {
		commands.push(command);
		if (command[1] === 'run' && command[2] === 'view')
			return {
				exitCode: 0,
				stderr: '',
				stdout: JSON.stringify(githubStatus())
			};
		if (command[1] === 'run' && command[2] === 'download') {
			const destination = command[command.indexOf('--dir') + 1];
			if (!destination)
				throw new Error('Fixture download has no destination.');
			const artifactName = command[command.indexOf('--name') + 1];
			await cp(
				artifactName?.includes('-promotion-')
					? promotionArtifact
					: sourceArtifact,
				destination,
				{ recursive: true }
			);

			return { exitCode: 0, stderr: '', stdout: '' };
		}
		if (command[0] === 'bunx') {
			expect(options.env?.GITHUB_REPOSITORY).toBe('absolutejs/example');
			expect(options.env?.GITHUB_REF).toBe('refs/heads/main');

			return { exitCode: 0, stderr: '', stdout: '' };
		}
		throw new Error(`Unexpected command: ${command.join(' ')}`);
	};

	return runner;
};

describe('mobile CI promotion audit', () => {
	test('parses only the requested sanitized workflow identity', () => {
		expect(
			parseAbsoluteMobileCiRunStatus(githubStatus(), PROMOTION_RUN_ID)
		).toMatchObject({
			conclusion: 'success',
			runId: PROMOTION_RUN_ID,
			status: 'completed'
		});
		expect(() =>
			parseAbsoluteMobileCiRunStatus(githubStatus(), '9999')
		).toThrow('identity does not match');
	});

	test('replays build, certification, promotion and local audit without credentials', async () => {
		const { promotionArtifact, root, sourceArtifact } = await fixture();
		const commands: string[][] = [];
		const runner = fixtureRunner(
			promotionArtifact,
			sourceArtifact,
			commands
		);
		const result = await auditAbsoluteMobileCiPromotion({
			outputDirectory: 'audit-output',
			projectRoot: root,
			repository: 'absolutejs/example',
			run: runner,
			runId: PROMOTION_RUN_ID
		});

		expect(result.audit).toMatchObject({
			github: {
				promotionRunId: PROMOTION_RUN_ID,
				sourceRunId: SOURCE_RUN_ID
			},
			platform: 'android',
			publication: { provider: 'registry' },
			status: 'verified'
		});
		expect(
			commands.filter((command) => command[2] === 'download')
		).toHaveLength(2);
		expect(commands.some((command) => command[0] === 'bunx')).toBe(true);
		const report = await readFile(
			join(result.directory, 'audit.md'),
			'utf8'
		);
		expect(report).toContain('**VERIFIED**');
		expect(report).not.toContain(root);
	});

	test('rejects a publication receipt bound to another release', async () => {
		const { promotionArtifact, root, sourceArtifact } = await fixture();
		const receiptPath = join(promotionArtifact, 'promotion-receipt.json');
		const receipt: unknown = JSON.parse(
			await readFile(receiptPath, 'utf8')
		);
		if (
			typeof receipt !== 'object' ||
			receipt === null ||
			!('channel' in receipt) ||
			typeof receipt.channel !== 'object' ||
			receipt.channel === null
		)
			throw new Error('Fixture promotion receipt is invalid.');
		await writeFile(
			receiptPath,
			`${JSON.stringify(
				{
					...receipt,
					channel: {
						...receipt.channel,
						releaseId: 'amobile_android_tampered'
					}
				},
				null,
				2
			)}\n`
		);

		await expect(
			auditAbsoluteMobileCiPromotion({
				outputDirectory: 'tampered-audit-output',
				projectRoot: root,
				run: fixtureRunner(promotionArtifact, sourceArtifact),
				runId: PROMOTION_RUN_ID
			})
		).rejects.toThrow('channel receipt does not match');
	});
});
