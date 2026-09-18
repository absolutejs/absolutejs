import { expect, test } from 'bun:test';
import { matchesAndroidAvdIdentity } from '../helpers/androidAvdIdentity';

test('owned-emulator identity tolerates Windows ADB console line endings but not other devices', () => {
	for (const ending of ['\n', '\r\n', '\r\r\n']) {
		expect(
			matchesAndroidAvdIdentity(`Owned${ending}OK${ending}`, 'Owned')
		).toBe(true);
		expect(
			matchesAndroidAvdIdentity(`Other${ending}Owned${ending}`, 'Owned')
		).toBe(false);
	}
	expect(matchesAndroidAvdIdentity('', 'Owned')).toBe(false);
	expect(matchesAndroidAvdIdentity('Owned-other\nOK', 'Owned')).toBe(false);
});
