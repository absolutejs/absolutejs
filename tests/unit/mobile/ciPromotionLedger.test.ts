import { afterEach, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	advanceAbsoluteMobilePromotionOperation,
	absoluteMobilePromotionOperationPath,
	createAbsoluteMobilePromotionOperation,
	listAbsoluteMobilePromotionOperations,
	parseAbsoluteMobilePromotionOperation,
	readAbsoluteMobilePromotionOperation,
	relativeAbsoluteMobilePromotionOperationPath
} from '../../../src/mobile/ciPromotionLedger';

const roots: string[] = [];
const ROOT = join(import.meta.dir, '..', '..', '..');
const DISPATCH_ID = `amp_${'a'.repeat(32)}`;
const SECOND_DISPATCH_ID = `amp_${'b'.repeat(32)}`;
const CERTIFICATION_ID = `amobile_cert_${'c'.repeat(64)}`;
const IOS_RELEASE_ID = `amobile_ios_${'d'.repeat(64)}`;
const ANDROID_RELEASE_ID = `amobile_android_${'e'.repeat(64)}`;

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-promotion-ledger-'));
	roots.push(root);

	return root;
};

const createOperation = (
	root: string,
	dispatchId = DISPATCH_ID,
	now = new Date('2026-09-17T12:00:00.000Z')
) =>
	createAbsoluteMobilePromotionOperation(root, {
		auditOutputDirectory: null,
		auditRequested: true,
		certificationId: CERTIFICATION_ID,
		certificationSha256: 'c'.repeat(64),
		channel: 'production',
		dispatchId,
		platform: 'ios',
		playTrack: null,
		ref: 'main',
		releaseId: IOS_RELEASE_ID,
		repository: 'absolutejs/example',
		sourceRunId: '1001',
		testflightGroup: 'Internal',
		testflightSubmitReview: false,
		watchRequested: true,
		workflow: '.github/workflows/absolute-mobile.yml',
		now: () => now
	});

describe('mobile CI promotion ledger', () => {
	test('persists a bounded non-secret operation before dispatch', async () => {
		const root = await fixture();
		const operation = await createOperation(root);
		const path = absoluteMobilePromotionOperationPath(root, DISPATCH_ID);
		const source = await readFile(path, 'utf8');

		expect(operation).toMatchObject({
			dispatchId: DISPATCH_ID,
			phase: 'dispatching',
			runId: null
		});
		expect(source).toContain(CERTIFICATION_ID);
		expect(source).not.toContain('certificate-secret');
		expect(source).not.toContain('certification_base64');
		expect(
			relativeAbsoluteMobilePromotionOperationPath(root, DISPATCH_ID)
		).toBe(
			`.absolutejs/mobile-ci/promotions/${DISPATCH_ID}/operation.json`
		);
		expect(await readdir(dirname(path))).toEqual(['operation.json']);
	});

	test('advances atomically and refuses identity rollback', async () => {
		const root = await fixture();
		await createOperation(root);
		await advanceAbsoluteMobilePromotionOperation(
			root,
			DISPATCH_ID,
			{ phase: 'dispatched' },
			() => new Date('2026-09-17T12:01:00.000Z')
		);
		await advanceAbsoluteMobilePromotionOperation(
			root,
			DISPATCH_ID,
			{
				phase: 'discovered',
				runId: '2002',
				url: 'https://github.com/absolutejs/example/actions/runs/2002'
			},
			() => new Date('2026-09-17T12:02:00.000Z')
		);
		await expect(
			advanceAbsoluteMobilePromotionOperation(root, DISPATCH_ID, {
				phase: 'discovered',
				runId: '3003',
				url: 'https://github.com/absolutejs/example/actions/runs/3003'
			})
		).rejects.toThrow('identity is immutable');
		const completed = await advanceAbsoluteMobilePromotionOperation(
			root,
			DISPATCH_ID,
			{
				conclusion: 'success',
				githubStatus: 'completed',
				phase: 'completed'
			},
			() => new Date('2026-09-17T12:03:00.000Z')
		);

		expect(completed).toMatchObject({
			conclusion: 'success',
			phase: 'completed',
			runId: '2002'
		});
		const audited = await advanceAbsoluteMobilePromotionOperation(
			root,
			DISPATCH_ID,
			{
				auditDirectory: '.absolutejs/mobile-ci/audits/2002',
				phase: 'audited'
			},
			() => new Date('2026-09-17T12:04:00.000Z')
		);
		expect(audited).toMatchObject({
			auditDirectory: '.absolutejs/mobile-ci/audits/2002',
			phase: 'audited'
		});
		await expect(
			advanceAbsoluteMobilePromotionOperation(root, DISPATCH_ID, {
				phase: 'dispatched'
			})
		).rejects.toThrow('cannot move backwards');
		expect(
			(
				await readdir(
					dirname(
						absoluteMobilePromotionOperationPath(root, DISPATCH_ID)
					)
				)
			).sort()
		).toEqual(['operation.json']);
	});

	test('lists newest operations and rejects incomplete recovered state', async () => {
		const root = await fixture();
		await createOperation(
			root,
			DISPATCH_ID,
			new Date('2026-09-17T12:00:00.000Z')
		);
		await createOperation(
			root,
			SECOND_DISPATCH_ID,
			new Date('2026-09-17T13:00:00.000Z')
		);

		expect(
			(await listAbsoluteMobilePromotionOperations(root)).map(
				(operation) => operation.dispatchId
			)
		).toEqual([SECOND_DISPATCH_ID, DISPATCH_ID]);
		const first = await readAbsoluteMobilePromotionOperation(
			root,
			DISPATCH_ID
		);
		expect(() =>
			parseAbsoluteMobilePromotionOperation({
				...first,
				phase: 'discovered',
				runId: null,
				url: null
			})
		).toThrow('phase is incomplete');
	});

	test('rejects replacement, traversal, oversized and malformed records', async () => {
		const root = await fixture();
		await createOperation(root);
		await expect(createOperation(root)).rejects.toMatchObject({
			code: 'EEXIST'
		});
		expect(() =>
			absoluteMobilePromotionOperationPath(root, '../escape')
		).toThrow('dispatch ID is invalid');
		const path = absoluteMobilePromotionOperationPath(
			root,
			SECOND_DISPATCH_ID
		);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, 'x'.repeat(65_537));
		await expect(
			readAbsoluteMobilePromotionOperation(root, SECOND_DISPATCH_ID)
		).rejects.toThrow('not found or is invalid');
		await writeFile(path, '{}');
		await expect(
			readAbsoluteMobilePromotionOperation(root, SECOND_DISPATCH_ID)
		).rejects.toThrow('operation is invalid');
	});

	test('resumes an ambiguous accepted dispatch without dispatching again', async () => {
		const root = await fixture();
		await createAbsoluteMobilePromotionOperation(root, {
			auditOutputDirectory: null,
			auditRequested: false,
			certificationId: CERTIFICATION_ID,
			certificationSha256: 'd'.repeat(64),
			channel: 'production',
			dispatchId: DISPATCH_ID,
			platform: 'android',
			playTrack: 'production',
			ref: null,
			releaseId: ANDROID_RELEASE_ID,
			repository: null,
			sourceRunId: '1001',
			testflightGroup: null,
			testflightSubmitReview: false,
			watchRequested: true,
			workflow: '.github/workflows/absolute-mobile.yml'
		});
		const bin = join(root, 'bin');
		await mkdir(bin);
		const log = join(root, 'gh.log');
		await writeFile(
			join(bin, 'gh'),
			`#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
if [ "$1 $2" = "run list" ]; then
  printf '%s\\n' '[{"databaseId":2002,"displayTitle":"AbsoluteJS mobile promotion [${DISPATCH_ID}]","event":"workflow_dispatch","url":"https://github.com/absolutejs/example/actions/runs/2002"}]'
elif [ "$1 $2" = "run watch" ]; then
  exit 0
elif [ "$1 $2" = "run view" ]; then
  printf '%s\\n' '{"conclusion":"success","createdAt":"2026-09-17T12:00:00Z","databaseId":2002,"displayTitle":"AbsoluteJS mobile promotion [${DISPATCH_ID}]","headBranch":"main","headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","jobs":[],"startedAt":"2026-09-17T12:00:01Z","status":"completed","updatedAt":"2026-09-17T12:01:00Z","url":"https://github.com/absolutejs/example/actions/runs/2002","workflowName":"AbsoluteJS Mobile"}'
else
  printf '%s\\n' "unexpected gh command: $*" >&2
  exit 9
fi
`,
			{ mode: 0o700 }
		);
		const subprocess = Bun.spawn(
			[
				process.execPath,
				join(ROOT, 'src/cli/index.ts'),
				'mobile',
				'ci',
				'promote',
				'--resume',
				DISPATCH_ID,
				'--json'
			],
			{
				cwd: root,
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH ?? ''}`
				},
				stderr: 'pipe',
				stdin: 'ignore',
				stdout: 'pipe'
			}
		);
		const [exitCode, stderr, stdout] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stderr).text(),
			new Response(subprocess.stdout).text()
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe('');
		expect(JSON.parse(stdout)).toMatchObject({
			dispatchId: DISPATCH_ID,
			runId: '2002',
			status: 'completed'
		});
		expect(await readFile(log, 'utf8')).not.toContain('workflow run');
		expect(
			await readAbsoluteMobilePromotionOperation(root, DISPATCH_ID)
		).toMatchObject({
			conclusion: 'success',
			phase: 'completed',
			runId: '2002'
		});

		const listed = Bun.spawnSync(
			[
				process.execPath,
				join(ROOT, 'src/cli/index.ts'),
				'mobile',
				'ci',
				'promotions',
				'--json'
			],
			{ cwd: root, stderr: 'pipe', stdout: 'pipe' }
		);
		expect(listed.exitCode).toBe(0);
		expect(JSON.parse(listed.stdout.toString())[0]).toMatchObject({
			dispatchId: DISPATCH_ID,
			phase: 'completed'
		});
	});
});
