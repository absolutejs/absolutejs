import { describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import type { AbsoluteDeviceCapabilityPlan } from '../../../src/mobile/deviceCapabilities';
import {
	createAbsoluteMobileUpdateRuntimeDescriptor,
	fingerprintAbsoluteMobileUpdateRuntime
} from '../../../src/mobile/updateRuntime';

const config = normalizeAbsoluteMobileConfig(
	{
		appId: 'com.example.absolute',
		appName: 'Absolute',
		deepLinks: { hosts: ['app.example.com'] },
		server: { productionOrigin: 'https://api.example.com' }
	},
	'/workspace'
);

const devices: AbsoluteDeviceCapabilityPlan = {
	capabilities: ['camera'],
	providers: {
		camera: {
			factory: 'createCamera',
			module: '@absolutejs/devices-capacitor/camera',
			packages: ['@capacitor/camera@8.2.3']
		}
	},
	requiredPackages: ['@capacitor/camera@8.2.3']
};

describe('mobile update runtime fingerprint', () => {
	test('is deterministic and changes across every native/data boundary', () => {
		const descriptor = createAbsoluteMobileUpdateRuntimeDescriptor({
			config,
			deviceCapabilities: devices,
			syncSchema: { components: [{ id: '@absolutejs/app', version: 1 }] }
		});
		const fingerprint = fingerprintAbsoluteMobileUpdateRuntime(descriptor);

		expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(fingerprintAbsoluteMobileUpdateRuntime(descriptor)).toBe(
			fingerprint
		);
		expect(
			fingerprintAbsoluteMobileUpdateRuntime({
				...descriptor,
				syncSchema: {
					components: [{ id: '@absolutejs/app', version: 2 }]
				}
			})
		).not.toBe(fingerprint);
		expect(
			fingerprintAbsoluteMobileUpdateRuntime({
				...descriptor,
				deviceCapabilities: {
					...devices,
					requiredPackages: ['@capacitor/camera@8.2.4']
				}
			})
		).not.toBe(fingerprint);
	});
});
