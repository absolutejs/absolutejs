import type { BuildConfig } from '../../types/build';
import {
	isInFileRouteRoot,
	resolveFileRoutes,
	syncFileRoutes
} from '../build/fileRoutes';
import { logWarn } from '../utils/logger';

/* File routes in `absolute dev` (see docs/FILE_ROUTER_PLAN.md): when a route
 * file or a `.server.ts` module is added, renamed or removed, rescan the
 * route folders and rewrite the route module. The rewrite is then handed to
 * the regular watcher pipeline (`notify`), which applies it to the running
 * server through backend HMR: the entry re-runs `fileRoutes(routeTree, …)`
 * and the new route answers without a restart. The page itself is built on
 * its first request, like any page in `pages/`. */

const RESCAN_DEBOUNCE_MS = 50;

const describeRoutes = (paths: Set<string>) => [...paths].sort().join(', ');

export const createFileRouteRefresher = (
	config: BuildConfig,
	notify: (path: string) => void
) => {
	if (!resolveFileRoutes(config)) return null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let known = new Set(
		syncFileRoutes(config)?.routes.map((route) => route.path) ?? []
	);

	const report = (next: Set<string>) => {
		const added = new Set([...next].filter((path) => !known.has(path)));
		const removed = new Set([...known].filter((path) => !next.has(path)));
		if (added.size > 0)
			console.log(`[file-routes] added ${describeRoutes(added)}`);
		if (removed.size > 0)
			console.log(`[file-routes] removed ${describeRoutes(removed)}`);
		known = next;
	};

	const rescan = () => {
		try {
			const scan = syncFileRoutes(config);
			if (!scan) return;
			for (const problem of scan.problems)
				logWarn(`[file-routes] ${problem}`);
			report(new Set(scan.routes.map((route) => route.path)));
			if (scan.written) notify(scan.output);
		} catch (error) {
			logWarn(
				`[file-routes] rescan failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	};

	return {
		/** Call for every watcher event; only route folders count. */
		onFileChange: (filePath: string) => {
			if (!isInFileRouteRoot(filePath)) return;
			clearTimeout(timer);
			timer = setTimeout(rescan, RESCAN_DEBOUNCE_MS);
		}
	};
};
