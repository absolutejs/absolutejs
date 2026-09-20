import { expect, test } from 'bun:test';
import { androidTestTransportConfig } from '../helpers/androidTestTransport';

test('transport override is opt-in and preserves surrounding configuration', () => {
	const config =
		'# transport\r\nhw.gltransport=pipe\r\nhw.gltransport.asg.writeStepSize=4096\r\n';
	expect(androidTestTransportConfig(config, undefined)).toBe(config);
	expect(androidTestTransportConfig(config, 'pipe')).toBe(config);
	expect(androidTestTransportConfig(config, 'asg')).toBe(
		config.replace('=pipe', '=asg')
	);
	expect(
		androidTestTransportConfig(' hw.gltransport = pipe\nother=yes', 'asg')
	).toBe('hw.gltransport=asg\nother=yes');
});

test('transport override adds a missing property with a line boundary', () => {
	expect(androidTestTransportConfig('', 'asg')).toBe('hw.gltransport=asg\n');
	expect(androidTestTransportConfig('other=yes', 'asg')).toBe(
		'other=yes\nhw.gltransport=asg\n'
	);
	expect(androidTestTransportConfig('other=yes\r\n', 'pipe')).toBe(
		'other=yes\r\nhw.gltransport=pipe\r\n'
	);
});

test('transport override rejects unsupported values and duplicate properties', () => {
	for (const value of ['', 'ASG', 'asg\nother=yes', 'virtio-gpu', ' pipe'])
		expect(() => androidTestTransportConfig('', value)).toThrow();
	expect(() =>
		androidTestTransportConfig(
			'hw.gltransport=pipe\n hw.gltransport=asg\n',
			'asg'
		)
	).toThrow();
});
