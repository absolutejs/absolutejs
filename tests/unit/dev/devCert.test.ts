import { describe, expect, test } from 'bun:test';
import { normalizeDevCertificateHosts } from '../../../src/dev/devCert';

describe('development HTTPS certificates', () => {
	test('keeps loopback identities and adds safe LAN hosts once', () => {
		expect(
			normalizeDevCertificateHosts([
				'192.168.1.40',
				'DEVBOX.local',
				'192.168.1.40',
				'0.0.0.0'
			])
		).toEqual([
			'localhost',
			'127.0.0.1',
			'::1',
			'192.168.1.40',
			'devbox.local'
		]);
	});

	test('rejects values that cannot be certificate identities', () => {
		expect(() => normalizeDevCertificateHosts(['host..local'])).toThrow(
			'Invalid development certificate host'
		);
	});
});
