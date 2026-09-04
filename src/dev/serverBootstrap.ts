import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { DEFAULT_PORT } from '../constants';
import {
	adoptParentBootMarks,
	markBoot,
	markBootAt,
	processStartEpochMs
} from '../utils/bootTimeline';
import { isStaleAbsoluteServerEntryCopy } from './serverEntryCopies';

// The dev bootstrap is the first module the `bun --hot` child evaluates, so
// this is where the CLI's marks join this process's timeline.
adoptParentBootMarks();
markBootAt('child process start', processStartEpochMs());
markBoot('bootstrap imports evaluated');

const originalEntry = process.env.ABSOLUTE_SERVER_ENTRY;
if (!originalEntry) {
	throw new Error(
		'ABSOLUTE_SERVER_ENTRY is required by the AbsoluteJS dev bootstrap'
	);
}

const entryPath = resolve(originalEntry);
if (!existsSync(entryPath)) {
	throw new Error(`AbsoluteJS server entry does not exist: ${entryPath}`);
}

const entryDir = dirname(entryPath);
const entryExtension = extname(entryPath) || '.ts';
const copyPrefix = '.absolutejs-hmr-';

const removeEntryCopy = (path: string) => {
	try {
		unlinkSync(path);
	} catch {
		/* another startup or shutdown already removed it */
	}
};

// A hard-killed prior dev process cannot run exit cleanup. Remove only
// framework-owned sibling entry copies whose owning process is no longer
// alive. Several dev servers can legitimately share a source directory (for
// example separate web/native sessions and integration workers), so deleting
// every matching sibling would race another server's active module import.
// During `bun --hot`, this module can also be re-evaluated while Bun is still
// loading an earlier copy; the cold-start guard preserves those live copies.
const isHotReevaluation = globalThis.__absoluteEntryCopies !== undefined;
if (!isHotReevaluation) {
	for (const name of readdirSync(entryDir)) {
		if (!name.startsWith(copyPrefix) || !name.endsWith(entryExtension)) {
			continue;
		}
		if (!isStaleAbsoluteServerEntryCopy(name)) continue;
		removeEntryCopy(join(entryDir, name));
	}
}

const bootstrapSequence =
	(globalThis.__absoluteEntryBootstrapSequence ?? 0) + 1;
globalThis.__absoluteEntryBootstrapSequence = bootstrapSequence;

const bootstrapCopy = join(
	entryDir,
	`${copyPrefix}${process.pid}-bootstrap-${bootstrapSequence}${entryExtension}`
);
copyFileSync(entryPath, bootstrapCopy);

const entryCopies = globalThis.__absoluteEntryCopies ?? new Set<string>();
entryCopies.add(bootstrapCopy);
globalThis.__absoluteEntryCopies = entryCopies;
if (!globalThis.__absoluteEntryCleanupRegistered) {
	globalThis.__absoluteEntryCleanupRegistered = true;
	process.on('exit', () => {
		for (const path of entryCopies) {
			removeEntryCopy(path);
		}
	});
}

// Bind the port NOW with a "Building…" placeholder so browsers, hosted
// previews and health probes get a 503 + Retry-After instead of a refused
// connection for the whole boot build. The `networking` plugin releases it
// right before the real `app.listen()`. Skipped on `bun --hot`
// re-evaluation (the real server is already bound) and when
// `ABSOLUTE_EARLY_LISTEN=0` opts out.
//
// When the CLI parent already holds that placeholder (it binds the port
// before spawning us, on an event loop that is not about to be blocked by
// the user's module graph), this process must NOT bind a second listener:
// with `SO_REUSEPORT` the kernel would hand roughly half the connections
// to a socket this thread cannot accept from until the import finishes,
// which is the exact stall the parent listener exists to remove. All we do
// then is arrange for the real server to bind alongside the parent's
// socket and to report the bind back.
if (
	!isHotReevaluation &&
	!globalThis.__absoluteBunServer &&
	process.env.ABSOLUTE_EARLY_LISTEN !== '0'
) {
	const {
		installEarlyListenerServeGuard,
		installParentPortHandoffGuard,
		parentOwnsDevPort,
		startEarlyListener
	} = await import('./earlyListener');
	const earlyHost =
		process.env.ABSOLUTE_HOST ?? process.env.HOST ?? 'localhost';
	const earlyPort = Number(
		process.env.ABSOLUTE_PORT ?? process.env.PORT ?? DEFAULT_PORT
	);
	const loadEarlyTls = async () => {
		if (process.env.NODE_ENV !== 'development') return null;
		if (process.env.ABSOLUTE_HTTPS !== 'true') return null;
		try {
			const { loadDevCert } = await import('./devCert');

			return loadDevCert();
		} catch {
			return null;
		}
	};
	if (Number.isInteger(earlyPort) && earlyPort > 0) {
		if (parentOwnsDevPort()) {
			installParentPortHandoffGuard(earlyPort);
			markBoot('parent listener adopted');
		} else {
			startEarlyListener({
				host: earlyHost,
				port: earlyPort,
				tls: await loadEarlyTls()
			});
			installEarlyListenerServeGuard(earlyPort);
			markBoot('early listener bound');
		}
	}
}

// Start the framework's boot work NOW, in parallel with the user's entry
// import. On a large app that import graph is seconds of module evaluation
// before `prepare()` is even reached, while the framework build is mostly
// I/O and native `Bun.build` work — so the two overlap. The user's
// `prepare()` joins this promise instead of starting a second build.
// The specifier is built at runtime so the bundler leaves it as a real
// import of the framework runtime (`dist/index.js`) — the exact module the
// user's entry imports — instead of inlining a second copy in here.
//
// The import-cost diagnostic turns this off. Its per-module numbers come
// from wall-clock gaps on this thread, and a build running inside those gaps
// lands on whichever module happened to be parsing — which is exactly the
// kind of misattribution the diagnostic exists to avoid. Measuring costs a
// slower boot; that is the trade the flag makes.
if (
	!isHotReevaluation &&
	process.env.NODE_ENV === 'development' &&
	process.env.ABSOLUTE_DEV_PREBUILD !== '0' &&
	process.env.ABSOLUTE_DEV_IMPORT_COST !== '1'
) {
	const compiledRuntime = join(import.meta.dir, '..', 'index.js');
	const runtimeEntry = existsSync(compiledRuntime)
		? compiledRuntime
		: join(import.meta.dir, '..', 'index.ts');
	markBoot('prebuild import issued');
	void import(runtimeEntry)
		.then((runtime: { startDevPrebuild?: () => Promise<unknown> }) => {
			markBoot('prebuild started');

			return runtime.startDevPrebuild?.();
		})
		.catch((error: unknown) => {
			// A failed prebuild must never take the boot down: the user's
			// own `prepare()` runs the same work on the normal path.
			console.error(
				`[dev] boot prebuild failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		});
}

// Import-cost diagnostic: hand the recorder the two module identities it
// cannot discover on its own — this bootstrap is the process root that
// reachability starts from, and `bootstrapCopy` is the module whose
// top-level imports are the candidates. Both are no-ops with the flag off.
const importCostRecorder = globalThis.__absoluteImportCost;
if (importCostRecorder !== undefined) {
	importCostRecorder.entryModule = bootstrapCopy;
	importCostRecorder.entryOriginalModule = entryPath;
	importCostRecorder.rootModule = import.meta.path;
}

// Keep the user's original entry out of Bun's --hot module graph. Bun can
// still hot-refresh its framework dependencies, while AbsoluteJS exclusively
// owns server-entry replacement through unique sibling imports.
markBoot('server entry import start');
await import(bootstrapCopy);
markBoot('server entry import done');

// Runs only when `ABSOLUTE_DEV_IMPORT_COST=1` preloaded the recorder; with
// the flag off this is one undefined property read.
await globalThis.__absoluteImportCostReport?.();
