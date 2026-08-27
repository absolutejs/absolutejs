import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import config from '../../fixtures/mobile-native-conformance/absolute.config';
import {
	absoluteNativeDevAdapterSource,
	buildAbsoluteNativeDevAdapter
} from '../../../src/mobile/devDeviceAdapter';

const projectRoot = resolve(import.meta.dir, '../../..');
const { mobile } = config;

if (!mobile) throw new Error('Native mobile fixture is invalid.');

describe('native development device adapter', () => {
	test('generates the same detected capability layer used by mobile bundles', () => {
		const source = absoluteNativeDevAdapterSource(projectRoot, mobile);

		expect(source).toContain('installCapacitorDeviceAdapterIfNative');
		expect(source).toContain('createCapacitorKeyboardCapability');
		expect(source).toContain('createCapacitorSystemBarsCapability');
		expect(source).toContain('"keyboard": absoluteDeviceCapability');
		expect(source).toContain('"systemBars": absoluteDeviceCapability');
		expect(source).toContain('absolutejs.com.absolutejs.conformance.');
	}, 15_000);

	test('bundles a browser-loadable module from project dependencies', async () => {
		const bundle = await buildAbsoluteNativeDevAdapter(projectRoot, mobile);

		expect(bundle.length).toBeGreaterThan(1_000);
		expect(bundle).toContain('Capacitor');
		expect(bundle).not.toContain(
			'from"@absolutejs/devices-capacitor/system-bars"'
		);
	}, 15_000);
});
