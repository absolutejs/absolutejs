import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	createLocalHttpsEmulator,
	nativeCapture
} from '../helpers/androidLocalHttps';
import { requireAndroidUiReadiness } from '../helpers/androidUiReadiness';
import { readAndroidUiSnapshot } from '../helpers/androidUiSnapshot';
import { saveAndroidDiagnostic } from '../helpers/androidDiagnostic';

const enabled = process.env.ABSOLUTE_TEST_ANDROID_RELEASE_READINESS === '1';
(enabled ? test : test.skip)(
	'disposable Android stays ready for repeated UI automation without app builds',
	async () => {
		const root = resolve(import.meta.dir, '../..');
		const output = join(
			root,
			'.absolutejs/release-data-conformance',
			randomUUID()
		);
		console.log(`[release-readiness] Evidence: ${output}`);
		const emulator = await createLocalHttpsEmulator(root, output);
		let sample = 0;
		const captureSample = async () => {
			const index = sample++;
			const xml = await readAndroidUiSnapshot(emulator.device, {
				onAttempt: async ({ attempt, output: diagnostic }) => {
					await writeFile(
						join(output, `soak-capture-${index}-${attempt}.log`),
						diagnostic
					);
				}
			});
			await writeFile(join(output, `soak-${index}.xml`), xml);

			return xml;
		};
		try {
			// In addition to initial preflight, observe three more rounds. Never
			// dismiss system dialogs or retry a failed readiness assertion.
			for (let round = 0; round < 3; round++) {
				await Bun.sleep(10_000);
				await requireAndroidUiReadiness(captureSample);
				console.log(`[release-readiness] Stable round ${round + 1}/3`);
			}
			expect(sample).toBe(9);
			await writeFile(
				join(output, 'readiness-report.json'),
				JSON.stringify(
					{
						additionalSnapshots: sample,
						appsInstalled: false,
						emulatorData: process.env
							.ABSOLUTE_TEST_RELEASE_REUSE_RUN
							? 'reused-test-avd'
							: 'fresh-test-avd',
						initialSnapshots: 3,
						status: 'pass'
					},
					null,
					2
				)
			);
		} finally {
			await saveAndroidDiagnostic(join(output, 'soak-final.png'), () =>
				nativeCapture(
					[
						emulator.adb,
						'-s',
						emulator.serial,
						'exec-out',
						'screencap',
						'-p'
					],
					root
				)
			);
			await saveAndroidDiagnostic(join(output, 'soak-logcat.txt'), () =>
				emulator.device('logcat', '-d', '-t', '2500')
			);
			await emulator.close();
		}
	},
	15 * 60 * 1000
);
