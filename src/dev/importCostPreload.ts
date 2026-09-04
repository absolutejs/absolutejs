/* `bun --preload` entry for `ABSOLUTE_DEV_IMPORT_COST=1`.
 *
 * Registered by `src/cli/scripts/dev.ts` alongside the existing dev-child
 * preload, and only when the flag is on: with the flag off the dev child is
 * spawned exactly as before and nothing here is loaded or parsed.
 *
 * A preloaded `onLoad` plugin is the right mechanism because it is the only
 * hook that sees a module before it evaluates. `onResolve` cannot be used for
 * the import graph — Bun resolves static imports inside its transpiler, so on
 * Bun 1.4 the hook only fires for the process entry and for dynamic imports,
 * and dynamic imports arrive with an empty importer. The graph is recovered
 * after boot instead, by re-scanning the sources of the modules that loaded. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plugin } from 'bun';
import {
	importCostLoader,
	instrumentModuleSource
} from './importCost/instrument';
import {
	ensureImportCostRecorder,
	IMPORT_COST_EVENT,
	IMPORT_COST_EVENT_KINDS
} from './importCost/recorder';
import { esmRegions, instrumentableFilter } from './importCost/scope';

const recorder = ensureImportCostRecorder();
const { events, moduleIds, moduleIndexes } = recorder;

const record = (moduleIndex: number, kind: number) => {
	events.push(
		moduleIndex * IMPORT_COST_EVENT_KINDS + kind,
		performance.now()
	);
};

globalThis.__absoluteImportCostEnter = (moduleIndex: number) => {
	if (!recorder.recording) return;
	record(moduleIndex, IMPORT_COST_EVENT.enter);
};

globalThis.__absoluteImportCostExit = (moduleIndex: number) => {
	if (!recorder.recording) return;
	record(moduleIndex, IMPORT_COST_EVENT.exit);
};

/** Resolved late so the analysis — and the `typescript` it needs for the
 *  static safety check — is only loaded once the boot window has closed. */
const reportModulePath = () => {
	const compiled = join(import.meta.dir, 'importCostReport.js');

	return existsSync(compiled)
		? compiled
		: join(import.meta.dir, 'importCost', 'report.ts');
};

globalThis.__absoluteImportCostReport = async () => {
	recorder.recording = false;
	try {
		const loaded: { reportImportCost?: () => void } = await import(
			reportModulePath()
		);
		loaded.reportImportCost?.();
	} catch (error) {
		console.error(
			`[absolute] import-cost report failed to load: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};

const moduleIndexOf = (path: string) => {
	const existing = moduleIndexes.get(path);
	if (existing !== undefined) return existing;
	const created = moduleIds.length;
	moduleIds.push(path);
	moduleIndexes.set(path, created);

	return created;
};

plugin({
	name: 'absolute-import-cost',
	setup(build) {
		build.onLoad(
			{ filter: instrumentableFilter(esmRegions(process.cwd())) },
			(args) => {
				const loader = importCostLoader(args.path);
				if (!recorder.recording) {
					return {
						contents: readFileSync(args.path, 'utf8'),
						loader
					};
				}
				const moduleIndex = moduleIndexOf(args.path);
				record(moduleIndex, IMPORT_COST_EVENT.loadStart);
				const contents = instrumentModuleSource(
					readFileSync(args.path, 'utf8'),
					moduleIndex
				);
				record(moduleIndex, IMPORT_COST_EVENT.loadEnd);

				return { contents, loader };
			}
		);
	}
});
