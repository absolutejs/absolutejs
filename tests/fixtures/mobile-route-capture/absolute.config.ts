import { defineConfig } from '../../../src/utils/defineConfig';

export default defineConfig({
	buildDirectory: 'tests/fixtures/mobile-route-capture/build',
	mobile: {
		appId: 'com.absolute.fixture',
		appName: 'Absolute Mobile Fixture',
		bundleDirectory: '.absolutejs/mobile-fixture-web',
		entry: '/v1/account/Ada',
		server: { productionOrigin: 'https://example.test' }
	},
	reactDirectory: 'tests/fixtures/mobile-route-capture/react'
});
