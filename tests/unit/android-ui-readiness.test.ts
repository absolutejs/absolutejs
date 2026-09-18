import { expect, test } from 'bun:test';
import { requireAndroidUiReadiness } from '../helpers/androidUiReadiness';

const launcher = '<node package="com.google.android.apps.nexuslauncher" />';
test('requires three healthy launcher samples separated by settling intervals', async () => {
	const events: string[] = [];
	await requireAndroidUiReadiness(
		async () => {
			events.push('sample');

			return launcher;
		},
		async () => {
			events.push('wait');
		}
	);
	expect(events).toEqual(['sample', 'wait', 'sample', 'wait', 'sample']);
});
test('does not dismiss an ANR or accept an obscured launcher', async () => {
	for (const xml of [
		'',
		'<node package="android" />',
		`${launcher}<node resource-id="android:id/aerr_wait" />`
	])
		await expect(
			requireAndroidUiReadiness(
				async () => xml,
				async () => {}
			)
		).rejects.toThrow();
});
test('rejects an ANR that appears after the first healthy sample', async () => {
	let samples = 0;
	await expect(
		requireAndroidUiReadiness(
			async () =>
				++samples === 1
					? launcher
					: '<node resource-id="android:id/aerr_close" />',
			async () => {}
		)
	).rejects.toThrow('startup ANR');
	expect(samples).toBe(2);
});
