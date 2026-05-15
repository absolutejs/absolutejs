/* AST-only scan of an Angular project: walks `.ts` sources looking for
 * `handleAngularPageRequest({...})` call sites, and walks the configured
 * `angularDirectory` for page modules that declare
 * `export const routes: Routes = [...]`.
 *
 * Used by `core/build.ts` to assemble the per-page providers metadata
 * (global `appProviders` source + per-page `hasRoutes` + per-page mount
 * `basePath`) it threads into `compileAngular` as `providersInjection`.
 * The compile pass then injects the literal providers declaration into
 * each page's compiled server output — no separate `.providers.ts` file
 * on disk, no runtime route-mounts lookup. */

import {
	scanAngularHandlerCalls,
	type AngularHandlerCall
} from './scanAngularHandlerCalls';
import {
	scanAngularPageRoutes,
	type AngularPageRoutes
} from './scanAngularPageRoutes';

export type AngularHandlerScanResult = {
	calls: AngularHandlerCall[];
	pageRoutes: AngularPageRoutes[];
};

export const runAngularHandlerScan = (
	projectRoot: string,
	angularDirectory: string
): AngularHandlerScanResult => ({
	calls: scanAngularHandlerCalls(projectRoot),
	pageRoutes: scanAngularPageRoutes(angularDirectory)
});
