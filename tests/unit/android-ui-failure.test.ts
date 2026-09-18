import { expect, test } from 'bun:test';
import { hasAndroidAnrDialog } from '../helpers/androidUiFailure';

test('identifies system ANR controls without treating app error text as an ANR', () => {
	expect(
		hasAndroidAnrDialog('<node resource-id="android:id/aerr_wait" />')
	).toBe(true);
	expect(
		hasAndroidAnrDialog('<node resource-id="android:id/aerr_close" />')
	).toBe(true);
	expect(hasAndroidAnrDialog('<node text="Unable to load" />')).toBe(false);
	expect(
		hasAndroidAnrDialog('<node text="Pixel Launcher isn’t responding" />')
	).toBe(false);
	expect(hasAndroidAnrDialog('')).toBe(false);
});
