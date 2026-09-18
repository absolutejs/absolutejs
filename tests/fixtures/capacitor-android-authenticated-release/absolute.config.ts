import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: '.absolutejs/build',
	mobile: {
		appId: 'com.absolutejs.capacitorauthproof',
		appName: 'AbsoluteJS Authenticated Release Proof',
		engine: 'capacitor',
		entry: '/',
		platforms: ['android'],
		server: {
			productionOrigin:
				process.env.ABSOLUTE_TEST_RELEASE_ORIGIN ??
				'https://localhost:48443'
		}
	},
	reactDirectory: 'react'
});
