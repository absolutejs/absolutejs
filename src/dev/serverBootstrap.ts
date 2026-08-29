import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
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

// Keep the user's original entry out of Bun's --hot module graph. Bun can
// still hot-refresh its framework dependencies, while AbsoluteJS exclusively
// owns server-entry replacement through unique sibling imports.
await import(bootstrapCopy);
