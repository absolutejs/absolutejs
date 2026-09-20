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

test('Vulkan isolation is explicit, independent of GPU mode, and rejects arbitrary flags', () => {
	expect(androidTestGraphicsArgs(undefined, '0')).toEqual([]);
	expect(androidTestGraphicsArgs(undefined, '1')).toEqual([
		'-feature',
		'-Vulkan'
	]);
	expect(androidTestGraphicsArgs('host', '1')).toEqual([
		'-gpu',
		'host',
		'-feature',
		'-Vulkan'
	]);
	for (const value of ['', 'true', '-wipe-data', '1 -wipe-data']) {
		expect(() => androidTestGraphicsArgs('host', value)).toThrow(
			'Unsupported'
		);
	}
});
