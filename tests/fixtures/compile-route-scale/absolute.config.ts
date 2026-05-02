import { defineConfig } from '__ABSOLUTE_DIST_INDEX__';
import { staticRoutes } from './runtime/routes';

export default defineConfig({
	buildDirectory: './build',
	publicDirectory: './public',
	reactDirectory: './react',
	static: {
		routes: staticRoutes
	}
});
