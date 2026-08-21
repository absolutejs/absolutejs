import { defineConfig } from '../../../src/utils/defineConfig';
import { appProviders } from '../../../example/angular/appProviders';

export default defineConfig({
	angular: { providers: appProviders },
	angularDirectory: 'example/angular',
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	emberDirectory: 'example/ember',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
	mobile: {
		appId: 'com.absolutejs.conformance',
		appName: 'AbsoluteJS Conformance',
		bundleDirectory: '.absolutejs/mobile-native-conformance/web',
		entry: '/react',
		nativeProject: {
			directory: '.absolutejs/mobile-native-conformance/native'
		},
		platforms: ['android'],
		server: { productionOrigin: 'https://conformance.absolutejs.com' }
	},
	publicDirectory: 'example/public',
	reactDirectory: 'example/react',
	stylesConfig: 'example/styles/indexes',
	svelteDirectory: 'example/svelte',
	tailwind: {
		input: 'example/styles/tailwind.css',
		output: 'assets/css/tailwind.generated.css'
	},
	vueDirectory: 'example/vue'
});
