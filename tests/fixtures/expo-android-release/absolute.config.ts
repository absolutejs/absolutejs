import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: '.absolutejs/build',
	mobile: {
		appId: 'com.absolutejs.exporeleaseacceptance',
		appName: 'AbsoluteJS Expo Release Acceptance',
		deepLinks: {
			android: {
				sha256CertificateFingerprints: ['AA'.repeat(32)]
			},
			hosts: ['release.absolutejs.test']
		},
		engine: 'expo',
		entry: '/',
		platforms: ['android'],
		server: { productionOrigin: 'https://release.absolutejs.test' }
	},
	reactDirectory: 'react'
});
