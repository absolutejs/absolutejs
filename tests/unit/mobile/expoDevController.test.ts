import { describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import { planAbsoluteExpoDevSession } from '../../../src/mobile/expoDevController';

const config = normalizeAbsoluteMobileConfig(
	{
		appId: 'com.example.product',
		appName: 'Product',
		engine: 'expo',
		platforms: ['android', 'ios'],
		server: { productionOrigin: 'https://api.example.com' }
	},
	'/workspace'
);

describe('Expo development controller', () => {
	test('coordinates one Metro server and both native development builds', () => {
		const plan = planAbsoluteExpoDevSession(config, {
			androidDevice: 'emulator-5554',
			androidOrigin: 'http://10.0.2.2:3000',
			iosOrigin: 'http://localhost:3000',
			metroPort: 8123,
			platforms: ['android', 'ios']
		});

		expect(plan.project).toBe('/workspace/.absolutejs/mobile/expo');
		expect(plan.commands).toHaveLength(4);
		expect(plan.commands[0]).toMatchObject({
			args: ['prebuild', '--clean', '--no-install', '--platform', 'all'],
			role: 'native-prepare'
		});
		expect(plan.commands[1]).toMatchObject({
			args: [
				'start',
				'--dev-client',
				'--host',
				'localhost',
				'--port',
				'8123'
			],
			role: 'metro'
		});
		expect(plan.commands[2]?.args).toEqual([
			'run:android',
			'--no-bundler',
			'--port',
			'8123',
			'--device',
			'emulator-5554'
		]);
		expect(plan.commands[3]?.args).toEqual([
			'run:ios',
			'--no-bundler',
			'--port',
			'8123'
		]);
		expect(plan.commands[1]?.env).toMatchObject({
			ABSOLUTE_EXPO_DEVELOPMENT: '1',
			EXPO_PUBLIC_ABSOLUTE_DEV_ANDROID_ORIGIN: 'http://10.0.2.2:3000',
			EXPO_PUBLIC_ABSOLUTE_DEV_IOS_ORIGIN: 'http://localhost:3000'
		});
	});

	test('requires an explicit locally supported target', () => {
		expect(() =>
			planAbsoluteExpoDevSession(config, {
				metroPort: 8081,
				platforms: []
			})
		).toThrow('local target platform');
	});
});
