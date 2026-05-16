import { defineConfig } from '../src/utils/defineConfig';
import { appProviders } from './angular/appProviders';

export default defineConfig({
	angular: { providers: appProviders },
	angularDirectory: 'example/angular',
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	emberDirectory: 'example/ember',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
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
