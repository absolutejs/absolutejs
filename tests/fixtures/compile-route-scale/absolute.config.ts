import { defineConfig } from '@absolutejs/absolute';
import { staticRoutes } from './runtime/routes';

export default defineConfig({
	buildDirectory: './build',
	publicDirectory: './public',
	reactDirectory: './react',
	static: {
		routes: staticRoutes
	}
});
