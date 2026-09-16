import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: '.absolutejs/build',
	mobile: {
		appId: 'com.absolutejs.capacitorreleaseacceptance',
		appName: 'AbsoluteJS Capacitor Release Acceptance',
		deepLinks: {
			android: {
				sha256CertificateFingerprints: ['AA'.repeat(32)]
			},
			hosts: ['release.absolutejs.test']
		},
		entry: '/',
		nativeProject: { directory: '.absolutejs/mobile' },
		platforms: ['android'],
		server: { productionOrigin: 'https://release.absolutejs.test' }
	},
	reactDirectory: 'react'
});
