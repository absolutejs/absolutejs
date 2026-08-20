import { defineConfig } from '../../../src/utils/defineConfig';

export default defineConfig({
	buildDirectory: 'tests/fixtures/mobile-route-capture/build',
	mobile: {
		appId: 'com.absolute.fixture',
		appName: 'Absolute Mobile Fixture',
		bundleDirectory: '.absolutejs/mobile-fixture-web',
		deepLinks: {
			android: {
				sha256CertificateFingerprints: [
					'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA'
				]
			},
			apple: { appIdPrefix: 'ABCDE12345' }
		},
		entry: '/v1/account/Ada',
		server: { productionOrigin: 'https://example.test' }
	},
	reactDirectory: 'tests/fixtures/mobile-route-capture/react'
});
