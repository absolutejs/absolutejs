import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAndroidDiagnostic } from '../helpers/androidDiagnostic';

test('captures binary diagnostics and contains capture/write failures', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'absolute-android-diagnostic-')
	);
	try {
		const path = join(directory, 'capture.bin');
		expect(
			await saveAndroidDiagnostic(
				path,
				async () => new Uint8Array([0, 255])
			)
		).toBe(true);
		expect([...(await readFile(path))]).toEqual([0, 255]);
		expect(
			await saveAndroidDiagnostic(path, async () => {
				throw new Error('ADB unavailable');
			})
		).toBe(false);
		expect(
			await saveAndroidDiagnostic(
				join(directory, 'missing', 'capture'),
				async () => 'output'
			)
		).toBe(false);
		// A failed command cannot replace existing evidence with empty content.
		expect([...(await readFile(path))]).toEqual([0, 255]);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
