import { expect, test } from 'bun:test';
import { androidTestGraphicsArgs } from '../helpers/androidTestGraphics';

test('test graphics preserves the default unless explicitly overridden', () => {
	expect(androidTestGraphicsArgs(undefined)).toEqual([]);
	for (const mode of [
		'auto',
		'host',
		'software',
		'lavapipe',
		'swiftshader',
		'swangle'
	])
		expect(androidTestGraphicsArgs(mode)).toEqual(['-gpu', mode]);
	for (const mode of ['', '-wipe-data', 'host -wipe-data'])
		expect(() => androidTestGraphicsArgs(mode)).toThrow('Unsupported');
});
