import { afterEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseAbsoluteIosHmrLog,
	waitForAbsoluteIosHmrLog
} from '../../../src/mobile/iosConformance';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('iOS native conformance log bridge', () => {
	test('parses iOS-target HMR timing without source identity', () => {
		expect(
			parseAbsoluteIosHmrLog(
				'12:00 [hmr:ios] react component account.tsx applied in 43ms; server 18ms, client 25ms'
			)
		).toMatchObject({
			clientMs: 25,
			duration: 43,
			outcome: 'applied',
			serverMs: 18
		});
		expect(
			parseAbsoluteIosHmrLog(
				'12:00 [hmr:web] react component account.tsx applied in 43ms'
			)
		).toBeNull();
	});

	test('waits only for output appended after the test begins', async () => {
		const directory = await mkdtemp(
			join(tmpdir(), 'absolute-ios-hmr-log-')
		);
		temporaryDirectories.push(directory);
		const logPath = join(directory, 'dev.log');
		await writeFile(
			logPath,
			'12:00 [hmr:ios] react old.tsx applied in 40ms\n'
		);
		setTimeout(
			() =>
				void appendFile(
					logPath,
					'12:01 [hmr:ios] vue component new.vue applied in 28ms; server 12ms, client 16ms\n'
				),
			20
		);
		const result = await waitForAbsoluteIosHmrLog({
			logPath,
			timeoutMs: 2_000
		});
		expect(result).toMatchObject({
			clientMs: 16,
			duration: 28,
			serverMs: 12
		});
	});
});
