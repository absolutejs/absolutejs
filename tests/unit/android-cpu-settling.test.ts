import { expect, test } from 'bun:test';
import { requireAndroidCpuSettled } from '../helpers/androidCpuSettling';

const pressure = (value: number) =>
	`some avg10=${value.toFixed(2)} avg60=0.00 avg300=0.00 total=123\n`;
test('requires three consecutive low-pressure samples after startup load settles', async () => {
	const values = [80, 10, 10, 40, 10, 10, 10];
	let reads = 0;
	let waits = 0;
	await requireAndroidCpuSettled(
		async () => pressure(values[reads++] ?? 100),
		async () => {
			waits++;
		}
	);
	expect(reads).toBe(7);
	expect(waits).toBe(6);
});

test('sustained load fails within a bounded number of samples', async () => {
	let reads = 0;
	await expect(
		requireAndroidCpuSettled(
			async () => {
				reads++;

				return pressure(90);
			},
			async () => {}
		)
	).rejects.toThrow('did not settle');
	expect(reads).toBe(36);
});

test('missing and malformed pressure readings cannot satisfy readiness', async () => {
	for (const value of [
		'',
		'full avg10=0.00 avg60=0.00',
		pressure(101),
		pressure(-1)
	]) {
		await expect(
			requireAndroidCpuSettled(
				async () => value,
				async () => {}
			)
		).rejects.toThrow('missing or invalid');
	}
});
