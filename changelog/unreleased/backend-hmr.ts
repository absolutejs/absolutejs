import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Editing a server module in development used to restart the whole server: a second or more of downtime, every open page dropped, every connection, pool, queue worker and in-memory cache rebuilt. Server modules are now updated in place, statement by statement. A save re-runs only the top-level statements whose own text changed, those that use something that changed, and the importer statements that call a changed export; everything else (database pools, workers, caches, `let` state) is kept as it was. A handler edit typically lands in 1–50ms with nothing else re-run, and exactly one update is applied per save. What a replaced statement started is stopped before its replacement runs: intervals, timeouts and timer chains (cron libraries included), immediates, `process` listeners, extra `Bun.serve` servers (a fixed port is handed over), workers and `onHotDispose` callbacks. Work started by requests and WebSocket events is never stopped. Rebuilding the Elysia app swaps it onto the running server and runs the old app's `cleanup` and the new app's `setup` hooks, as a stop followed by a listen would. An edit that fails to parse or throws while running keeps the previous version serving, and everything it started is rolled back; the fix applies normally. Set `ABSOLUTE_BACKEND_HMR=0` to restart on server edits as before. See docs/BACKEND_HMR.md.",
	kind: 'added',
	summary:
		'Server code edits in development update the running server in place instead of restarting it',
	symbols: ['onHotDispose']
};
