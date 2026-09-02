import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { DEFAULT_PORT } from '../constants';
import { isStaleAbsoluteServerEntryCopy } from './serverEntryCopies';

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
if (
	!isHotReevaluation &&
	!globalThis.__absoluteBunServer &&
	process.env.ABSOLUTE_EARLY_LISTEN !== '0'
) {
	const { startEarlyListener, installEarlyListenerServeGuard } = await import(
		'./earlyListener'
	);
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
		startEarlyListener({
			host: earlyHost,
			port: earlyPort,
			tls: await loadEarlyTls()
		});
		installEarlyListenerServeGuard(earlyPort);
	}
}

// Keep the user's original entry out of Bun's --hot module graph. Bun can
// still hot-refresh its framework dependencies, while AbsoluteJS exclusively
// owns server-entry replacement through unique sibling imports.
await import(bootstrapCopy);
