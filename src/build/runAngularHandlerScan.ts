/* Single entry point the build orchestrator calls before any
 * `compileAngular` invocation. Runs the three steps of the
 * providers-from-handler-call pipeline:
 *
 *   1. Scan project TypeScript for `handleAngularPageRequest({...})`
 *      calls (`scanAngularHandlerCalls`).
 *   2. Emit one generated providers file per page, with imports recreated
 *      and an inferred `APP_BASE_HREF` provider appended for sub-router
 *      pages (`emitAngularProvidersFiles`).
 *   3. Emit a single shared route-mounts map the SSR handler imports at
 *      module-load time to derive `APP_BASE_HREF` per request
 *      (`emitAngularRouteMounts`).
 *
 * Wrapped here so `core/build.ts` doesn't need to know the orchestration
 * order. Returns the metadata so downstream build steps (the
 * `compileAngular` wrapper template) can check whether a given page has
 * a generated providers file. */

import {
	emitAngularProvidersFiles,
	type EmittedProvidersFile
} from './emitAngularProvidersFiles';
import { emitAngularRouteMounts } from './emitAngularRouteMounts';
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
	providersFiles: EmittedProvidersFile[];
	/** Set of manifest keys that have a generated providers file the
	 *  client bundle can import. */
	manifestKeysWithProviders: Set<string>;
};

export const runAngularHandlerScan = (
	projectRoot: string,
	angularDirectory: string
): AngularHandlerScanResult => {
	const calls = scanAngularHandlerCalls(projectRoot);
	const pageRoutes = scanAngularPageRoutes(angularDirectory);
	const providersFiles = emitAngularProvidersFiles(
		projectRoot,
		calls,
		pageRoutes
	);
	emitAngularRouteMounts(projectRoot, calls);

	return {
		calls,
		manifestKeysWithProviders: new Set(
			providersFiles.map((file) => file.manifestKey)
		),
		pageRoutes,
		providersFiles
	};
};
