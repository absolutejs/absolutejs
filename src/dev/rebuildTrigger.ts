import { existsSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { build } from '../core/build';
import type { BuildConfig } from '../../types/build';
import { scanEntryPoints } from '../build/scanEntryPoints';
import { loadIslandRegistryBuildInfo } from '../build/islandEntries';
import {
	getPagesUsingIslandSource,
	loadPageIslandMetadata,
	setCurrentPageIslandMetadata
} from '../islands/pageMetadata';
import {
	logCssUpdate,
	logHmrUpdate,
	logInfo,
	logScriptUpdate,
	logWarn
} from '../utils/logger';
import { incrementSourceFileVersions, type HMRState } from './clientManager';
import { getAffectedFiles } from './dependencyGraph';
import { DEFAULT_DEBOUNCE_MS, REBUILD_BATCH_DELAY_MS } from '../constants';
import { computeFileHash, hasFileChanged } from './fileHashTracker';
import { invalidate as invalidateTransformCache } from './transformCache';

// Eagerly resolve the moduleServer import at load time so the first
// HMR update doesn't pay the dynamic-import cost. By the time this
// module is imported, prepare.ts has already loaded moduleServer, so
// this resolves from Bun's module cache instantly.
const moduleServerPromise = import('../dev/moduleServer');
const getModuleServer = () => moduleServerPromise;
import {
	createModuleUpdates,
	groupModuleUpdatesByFramework,
	type ModuleUpdate
} from './moduleMapper';
import {
	incrementModuleVersions,
	serializeModuleVersions
} from './moduleVersionTracker';
import { sendTelemetryEvent } from '../cli/telemetryEvent';
import { cleanStaleAssets, populateAssetStore } from './assetStore';
import { detectFramework } from './pathUtils';
import { toPascal } from '../utils/stringModifiers';
import type { ResolvedBuildPaths } from './configResolver';
import { broadcastToClients } from './webSocket';
import {
	createStyleTransformConfig,
	createStylePreprocessorPlugin,
	findStyleEntriesImporting,
	getStyleBaseName,
	isStylePath
} from '../build/stylePreprocessor';
import { isTailwindCandidate } from '../build/compileTailwind';
import { incrementalTailwindBuild } from '../build/tailwindCompiler';
import { markSsrCacheDirty } from '../core/ssrCache';

const runSequentially = <Item>(
	items: Item[],
	action: (item: Item) => Promise<void>
) =>
	items.reduce(
		(chain, item) => chain.then(() => action(item)),
		Promise.resolve()
	);

const getStyleTransformConfig = (config: BuildConfig) =>
	createStyleTransformConfig(config.stylePreprocessors, config.postcss);

/* When a fast path handles a file change, the full build doesn't run, so
   Tailwind never gets a chance to rescan source files. If the changed file
   is something Tailwind would scan (.tsx/.svelte/.vue/.html/etc.), we rerun
   Tailwind here and broadcast a CSS reload so newly-referenced utility
   classes actually appear in the emitted CSS. Without this the markup ends
   up referencing classes that have no rules behind them until the next
   full restart.

   Uses the persistent in-memory Tailwind compiler — instantiated once and
   reused — so HMR ticks pay only the candidate-scan + serialize cost, not
   the bundler-init + compiler-init cost of a fresh `bun.build`. The result
   is content-hashed so we suppress the CSS-reload broadcast when the
   emitted output didn't actually change (an edit that doesn't add or
   remove any utility classes shouldn't refetch every stylesheet). */
const recompileTailwindForFastPath = async (
	state: HMRState,
	config: BuildConfig,
	files: string[]
) => {
	if (!config.tailwind) return;
	if (!files.some(isTailwindCandidate)) return;

	try {
		const { cssChanged } = await incrementalTailwindBuild(
			config.tailwind,
			state.resolvedPaths.buildDir,
			files,
			getStyleTransformConfig(config)
		);
		if (!cssChanged) return;

		broadcastToClients(state, {
			data: { framework: 'tailwind', manifest: state.manifest },
			message: 'Tailwind utilities recompiled',
			type: 'style-update'
		});
	} catch (err) {
		sendTelemetryEvent('hmr:error', {
			framework: 'tailwind',
			message: err instanceof Error ? err.message : String(err)
		});
	}
};

type BuildLog = {
	level?: string;
	message: string | { text: string };
	position?: {
		file?: string;
		line?: number;
		column?: number;
		lineText?: string;
	};
};

const parseErrorLocationFromMessage = (msg: string) => {
	const pathLineCol = msg.match(/^([^\s:]+):(\d+)(?::(\d+))?/);
	if (pathLineCol) {
		const [, file, lineStr, colStr] = pathLineCol;

		return {
			column: colStr ? parseInt(colStr, 10) : undefined,
			file,
			line: lineStr ? parseInt(lineStr, 10) : undefined
		};
	}
	const atMatch = msg.match(
		/(?:at|in)\s+([^(:\s]+)(?:\s*\([^)]*line\s*(\d+)[^)]*col(?:umn)?\s*(\d+)[^)]*\)|:(\d+):(\d+)?)/i
	);
	if (atMatch) {
		const [, file, line1, col1, line2, col2] = atMatch;

		let parsedCol: number | undefined;
		if (col1) parsedCol = parseInt(col1, 10);
		else if (col2) parsedCol = parseInt(col2, 10);

		let parsedLine: number | undefined;
		if (line1) parsedLine = parseInt(line1, 10);
		else if (line2) parsedLine = parseInt(line2, 10);

		return {
			column: parsedCol,
			file: file?.trim(),
			line: parsedLine
		};
	}
	const parenMatch = msg.match(
		/([^\s(]+)\s*\([^)]*line\s*(\d+)[^)]*col(?:umn)?\s*(\d+)/i
	);
	if (parenMatch) {
		const [, file, lineStr, colStr] = parenMatch;

		return {
			column: colStr ? parseInt(colStr, 10) : undefined,
			file: file ?? undefined,
			line: lineStr ? parseInt(lineStr, 10) : undefined
		};
	}

	return {};
};

const extractBuildErrorDetails = (
	error: unknown,
	affectedFrameworks: string[],
	resolvedPaths?: ResolvedBuildPaths
) => {
	const errorObj = error && typeof error === 'object' ? error : undefined;
	const rawLogs =
		errorObj && 'logs' in errorObj && Array.isArray(errorObj.logs)
			? errorObj.logs
			: undefined;
	const logs: BuildLog[] | undefined =
		rawLogs ??
		(error instanceof AggregateError && error.errors?.length
			? error.errors
			: undefined);
	if (logs && Array.isArray(logs) && logs.length > 0) {
		const errLog = logs.find((l) => l.level === 'error') ?? logs[0];
		const pos = errLog?.position;
		const file = pos?.file;
		const line = pos?.line;
		const column = pos?.column;
		const lineText = pos?.lineText;
		const framework =
			file && resolvedPaths
				? detectFramework(file, resolvedPaths)
				: (affectedFrameworks[0] ?? 'unknown');

		return {
			column,
			file,
			framework:
				framework !== 'ignored' ? framework : affectedFrameworks[0],
			line,
			lineText
		};
	}
	const msg = error instanceof Error ? error.message : String(error);
	const parsed = parseErrorLocationFromMessage(msg);
	let [detectedFw] = affectedFrameworks;
	if (parsed.file && resolvedPaths) {
		const detected = detectFramework(parsed.file, resolvedPaths);
		detectedFw = detected !== 'ignored' ? detected : affectedFrameworks[0];
	}

	return { ...parsed, framework: detectedFw };
};

const isValidDeletedAffectedFile = (
	affectedFile: string,
	deletedPathResolved: string,
	processedFiles: Set<string>
) =>
	affectedFile !== deletedPathResolved &&
	!processedFiles.has(affectedFile) &&
	existsSync(affectedFile);

const collectDeletedFileAffected = (
	state: HMRState,
	filePathInSet: string,
	processedFiles: Set<string>,
	validFiles: string[]
) => {
	state.fileHashes.delete(filePathInSet);
	try {
		const affectedFiles = getAffectedFiles(
			state.dependencyGraph,
			filePathInSet
		);
		const deletedPathResolved = resolve(filePathInSet);
		affectedFiles.forEach((affectedFile) => {
			if (
				isValidDeletedAffectedFile(
					affectedFile,
					deletedPathResolved,
					processedFiles
				)
			) {
				validFiles.push(affectedFile);
				processedFiles.add(affectedFile);
			}
		});
	} catch {
		/* ignored */
	}
};

const incrementDependentVersions = (
	state: HMRState,
	normalizedFilePath: string
) => {
	try {
		const dependents =
			state.dependencyGraph.dependents.get(normalizedFilePath);
		if (!dependents || dependents.size === 0) {
			return;
		}
		const dependentFiles = Array.from(dependents).filter((file) =>
			existsSync(file)
		);
		if (dependentFiles.length === 0) {
			return;
		}
		incrementSourceFileVersions(state, dependentFiles);
	} catch {
		/* ignored */
	}
};

const addUnprocessedFile = (
	normalizedFilePath: string,
	processedFiles: Set<string>,
	validFiles: string[]
) => {
	if (processedFiles.has(normalizedFilePath)) {
		return;
	}

	validFiles.push(normalizedFilePath);
	processedFiles.add(normalizedFilePath);
};

const collectChangedFileAffected = (
	state: HMRState,
	normalizedFilePath: string,
	processedFiles: Set<string>,
	validFiles: string[]
) => {
	try {
		const affectedFiles = getAffectedFiles(
			state.dependencyGraph,
			normalizedFilePath
		);
		affectedFiles.forEach((affectedFile) => {
			if (
				!processedFiles.has(affectedFile) &&
				affectedFile !== normalizedFilePath &&
				existsSync(affectedFile)
			) {
				validFiles.push(affectedFile);
				processedFiles.add(affectedFile);
			}
		});
	} catch {
		addUnprocessedFile(normalizedFilePath, processedFiles, validFiles);
	}
};

const processChangedFile = (
	state: HMRState,
	filePathInSet: string,
	processedFiles: Set<string>,
	validFiles: string[]
) => {
	const fileHash = computeFileHash(filePathInSet);
	const storedHash = state.fileHashes.get(filePathInSet);

	if (storedHash !== undefined && storedHash === fileHash) {
		return;
	}

	const normalizedFilePath = resolve(filePathInSet);

	if (!processedFiles.has(normalizedFilePath)) {
		validFiles.push(normalizedFilePath);
		processedFiles.add(normalizedFilePath);
	}

	state.fileHashes.set(normalizedFilePath, fileHash);
	incrementSourceFileVersions(state, [normalizedFilePath]);
	incrementDependentVersions(state, normalizedFilePath);
	collectChangedFileAffected(
		state,
		normalizedFilePath,
		processedFiles,
		validFiles
	);
};

const processFilePathSet = (
	state: HMRState,
	filePathSet: Set<string>,
	processedFiles: Set<string>,
	validFiles: string[]
) => {
	filePathSet.forEach((filePathInSet) => {
		if (!existsSync(filePathInSet)) {
			collectDeletedFileAffected(
				state,
				filePathInSet,
				processedFiles,
				validFiles
			);

			return;
		}
		processChangedFile(state, filePathInSet, processedFiles, validFiles);
	});
};

const detectFrameworkForValidFiles = (
	validFiles: string[],
	state: HMRState
) => {
	const [firstFile] = validFiles;
	if (!firstFile) {
		return undefined;
	}

	return detectFramework(firstFile, state.resolvedPaths);
};

const buildFilesToProcess = (state: HMRState) => {
	const filesToProcess: Map<string, string[]> = new Map();

	const uniqueFilesByFramework = new Map<string, Set<string>>();
	state.fileChangeQueue.forEach((filePaths, fwKey) => {
		uniqueFilesByFramework.set(fwKey, new Set(filePaths));
	});

	uniqueFilesByFramework.forEach((filePathSet) => {
		const validFiles: string[] = [];
		const processedFiles = new Set<string>();

		processFilePathSet(state, filePathSet, processedFiles, validFiles);

		if (validFiles.length === 0) {
			return;
		}

		const detectedFramework = detectFrameworkForValidFiles(
			validFiles,
			state
		);
		if (detectedFramework) {
			filesToProcess.set(detectedFramework, validFiles);
		}
	});

	return filesToProcess;
};

const STABILITY_CHECK_ROUNDS = 5;
const STABILITY_CHECK_DELAY_MS = 10;

const isFileStable = async (file: string) => {
	const hash1 = computeFileHash(file);
	await Bun.sleep(STABILITY_CHECK_DELAY_MS);
	const hash2 = computeFileHash(file);

	return hash1 === hash2;
};

const collectAllQueuedFiles = (fileChangeQueue: Map<string, string[]>) => {
	const allFiles: string[] = [];
	for (const files of fileChangeQueue.values()) {
		allFiles.push(...files);
	}

	return allFiles;
};

const areAllQueuedFilesStable = async (
	fileChangeQueue: Map<string, string[]>
) => {
	const allFiles = collectAllQueuedFiles(fileChangeQueue);
	const checkFile = async (files: string[]) => {
		const [file, ...remaining] = files;
		if (!file) {
			return true;
		}

		const stable = await isFileStable(file);
		if (!stable) {
			return false;
		}

		return checkFile(remaining);
	};

	return checkFile(allFiles);
};

const waitForStableWrites = async (state: HMRState) => {
	const waitRound = async (round: number) => {
		if (round >= STABILITY_CHECK_ROUNDS) {
			return;
		}

		const stable = await areAllQueuedFilesStable(state.fileChangeQueue);
		if (stable) {
			return;
		}

		await waitRound(round + 1);
	};

	await waitRound(0);
};

const enqueueImporter = (state: HMRState, importer: string) => {
	const importerFramework = detectFramework(importer, state.resolvedPaths);
	if (importerFramework === 'ignored') return;
	if (!state.fileChangeQueue.has(importerFramework)) {
		state.fileChangeQueue.set(importerFramework, []);
	}
	const importerQueue = state.fileChangeQueue.get(importerFramework);
	if (importerQueue && !importerQueue.includes(importer)) {
		importerQueue.push(importer);
	}
};

const enqueueStyleImporters = (state: HMRState, changedStylePath: string) => {
	for (const importer of findStyleEntriesImporting(changedStylePath)) {
		enqueueImporter(state, importer);
	}
};

export const queueFileChange = async (
	state: HMRState,
	filePath: string,
	config: BuildConfig,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	const framework = detectFramework(filePath, state.resolvedPaths);

	if (framework === 'ignored') {
		return;
	}

	const currentHash = computeFileHash(filePath);

	if (!hasFileChanged(filePath, currentHash, state.fileHashes)) {
		return;
	}

	// Shared files (workers, utils, etc.) that don't belong to any
	// framework just need their transform cache invalidated — no rebuild.
	if (framework === 'unknown') {
		invalidateTransformCache(resolve(filePath));
		const relPath = relative(process.cwd(), filePath);
		logHmrUpdate(relPath);

		return;
	}

	if (!state.fileChangeQueue.has(framework)) {
		state.fileChangeQueue.set(framework, []);
	}

	const queue = state.fileChangeQueue.get(framework);
	if (queue && !queue.includes(filePath)) {
		queue.push(filePath);
	}

	// If a stylesheet partial (e.g. _tokens.scss) changed, also enqueue
	// every entry stylesheet that imported it during its last compile.
	// Without this the importer would silently keep the stale CSS until
	// the next full restart.
	if (isStylePath(filePath)) {
		enqueueStyleImporters(state, filePath);
	}

	if (state.isRebuilding) {
		return;
	}

	if (state.rebuildTimeout) {
		clearTimeout(state.rebuildTimeout);
	}

	const DEBOUNCE_MS = config.options?.hmr?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	state.rebuildTimeout = setTimeout(async () => {
		// Wait for file writes to stabilize. Editors using atomic writes
		// (write .tmp → rename) can trigger the watcher before the rename
		// completes. Read the file twice with a gap — if hashes match,
		// the write is stable.
		await waitForStableWrites(state);

		// Capture the user's actual edits — the file paths in
		// `fileChangeQueue` BEFORE the dependency graph expands them with
		// transitive dependents. The Angular HMR classifier needs the
		// pristine set so it can pick the right fast path (a CSS edit
		// shouldn't classify as a class-component reboot just because
		// the graph also flagged the sibling .component.ts as affected).
		const userEditedFiles = new Set<string>();
		state.fileChangeQueue.forEach((filePaths) => {
			for (const filePath of filePaths) {
				userEditedFiles.add(resolve(filePath));
			}
		});
		state.lastUserEditedFiles = userEditedFiles;

		const filesToProcess = buildFilesToProcess(state);
		state.fileChangeQueue.clear();

		if (filesToProcess.size === 0) {
			return;
		}

		const affectedFrameworks = Array.from(filesToProcess.keys());

		affectedFrameworks.forEach((frameworkKey) => {
			state.rebuildQueue.add(frameworkKey);
		});

		const filesToRebuild: string[] = [];
		filesToProcess.forEach((filePaths) => {
			filesToRebuild.push(...filePaths);
		});

		void triggerRebuild(state, config, onRebuildComplete, filesToRebuild);
	}, DEBOUNCE_MS);
};

const resolveComponentLookupFile = (
	componentFile: string,
	graph?: HMRState['dependencyGraph']
) => {
	if (!componentFile.endsWith('.html')) {
		return componentFile;
	}
	// Try same-name .ts counterpart (co-located template)
	const tsCounterpart = componentFile.replace(/\.html$/, '.ts');
	if (existsSync(tsCounterpart)) {
		return tsCounterpart;
	}
	// For external templates (templateUrl in a different dir),
	// use the dependency graph to find the .ts that references this .html
	if (!graph) return componentFile;

	const dependents = graph.dependents.get(resolve(componentFile));
	if (!dependents) return componentFile;

	for (const dep of dependents) {
		if (dep.endsWith('.ts')) return dep;
	}

	return componentFile;
};

const resolveAngularPageEntries = (
	state: HMRState,
	angularFiles: string[],
	angularPagesPath: string
) => {
	const pageEntries = angularFiles.filter(
		(file) =>
			file.endsWith('.ts') && resolve(file).startsWith(angularPagesPath)
	);

	if (pageEntries.length > 0 || !state.dependencyGraph) {
		return pageEntries;
	}

	const resolvedPages = new Set<string>();
	angularFiles.forEach((componentFile) => {
		const lookupFile = resolveComponentLookupFile(
			componentFile,
			state.dependencyGraph
		);
		const affected = getAffectedFiles(state.dependencyGraph, lookupFile);
		affected.forEach((file) => {
			if (
				file.endsWith('.ts') &&
				resolve(file).startsWith(angularPagesPath)
			) {
				resolvedPages.add(file);
			}
		});
	});

	return Array.from(resolvedPages);
};

const computeClientRoot = async (resolvedPaths: ResolvedBuildPaths) => {
	// Mirror core/build.ts client-root math: framework compilers now emit
	// to <projectRoot>/.absolutejs/generated/<framework>/, so the Bun.build
	// root is the cache's `generated/` parent. HTML/HTMX entries live in
	// the user's source dirs and merge into the common ancestor.
	const { getGeneratedRoot } = await import('../utils/generatedDir');
	const projectRoot = process.cwd();
	const clientRoots: string[] = [
		resolvedPaths.htmlDir,
		resolvedPaths.htmxDir
	].filter((dir): dir is string => Boolean(dir));
	const usesGenerated =
		Boolean(resolvedPaths.reactDir) ||
		Boolean(resolvedPaths.svelteDir) ||
		Boolean(resolvedPaths.vueDir) ||
		Boolean(resolvedPaths.angularDir);
	if (usesGenerated) clientRoots.push(getGeneratedRoot(projectRoot));

	const { commonAncestor } = await import('../utils/commonAncestor');

	return clientRoots.length === 1
		? (clientRoots[0] ?? projectRoot)
		: commonAncestor(clientRoots, projectRoot);
};

const updateServerManifestEntry = (
	state: HMRState,
	artifact: { path: string; hash: string | null }
) => {
	const fileWithHash = basename(artifact.path);
	const [baseName] = fileWithHash.split(`.${artifact.hash}.`);
	if (!baseName) {
		return;
	}
	state.manifest[toPascal(baseName)] = artifact.path;
};

const bundleAngularClient = async (
	state: HMRState,
	clientPaths: string[],
	buildDir: string,
	userAngularRoot: string
) => {
	const { build: bunBuild } = await import('bun');
	const { generateManifest } = await import('../build/generateManifest');
	const { getAngularVendorPaths } = await import('../core/devVendorPaths');
	const { getFrameworkGeneratedDir } = await import('../utils/generatedDir');
	const { createAngularHmrInjectionPlugin } = await import(
		'./angular/hmrInjectionPlugin'
	);
	const clientRoot = await computeClientRoot(state.resolvedPaths);
	const depVendorPaths = globalThis.__depVendorPaths ?? {};
	const generatedAngularRoot = getFrameworkGeneratedDir('angular');

	let angVendorPaths = getAngularVendorPaths();
	if (!angVendorPaths) {
		const { computeAngularVendorPaths } = await import(
			'../build/buildAngularVendor'
		);
		const { setAngularVendorPaths } = await import(
			'../core/devVendorPaths'
		);
		angVendorPaths = computeAngularVendorPaths(
			globalThis.__angularVendorSpecifiers
		);
		setAngularVendorPaths(angVendorPaths);
	}

	const clientResult = await bunBuild({
		entrypoints: clientPaths,
		...(Object.keys({
			...(angVendorPaths ?? {}),
			...depVendorPaths
		}).length > 0
			? {
					external: Object.keys({
						...(angVendorPaths ?? {}),
						...depVendorPaths
					})
				}
			: {}),
		format: 'esm',
		naming: '[dir]/[name].[hash].[ext]',
		outdir: buildDir,
		plugins: [
			createStylePreprocessorPlugin(getStyleTransformConfig(state.config)),
			createAngularHmrInjectionPlugin({
				generatedAngularRoot,
				userAngularRoot,
				projectRoot: process.cwd()
			})
		],
		root: clientRoot,
		target: 'browser',
		throw: false
	});

	if (!clientResult.success) {
		return;
	}

	if (angVendorPaths || Object.keys(depVendorPaths).length > 0) {
		const { rewriteImports } = await import('../build/rewriteImports');
		await rewriteImports(
			clientResult.outputs.map((artifact) => artifact.path),
			{
				...(angVendorPaths ?? {}),
				...depVendorPaths
			}
		);
	}

	const clientManifest = generateManifest(clientResult.outputs, buildDir);
	Object.assign(state.manifest, clientManifest);
	await populateAssetStore(state.assetStore, clientManifest, buildDir);
};

/* Tiered Angular HMR dispatch.
 *
 *   Tier 0 — surgical (`ɵɵreplaceMetadata`). User-visible state
 *            preserved. Broadcasts `angular:component-update` per
 *            affected component; the `__ng_hmr_load` listener
 *            baked into the bundle by `hmrInjectionPlugin.ts`
 *            re-fetches `/@ng/component` and swaps in place.
 *
 *   Tier 1 — Angular re-bootstrap. `tryFastHmr` returns
 *            `structural-change` (or any non-`ok` reason
 *            `resolveOwningComponents` produced); the bundle's
 *            structure may not match the running app. The client
 *            destroys `ApplicationRef`, dynamic-imports the
 *            freshly-built page module with cache-bust, and
 *            re-bootstraps. Loses Angular component state but
 *            keeps the rest of the browser session. Broadcasts
 *            `angular:rebootstrap`.
 *
 *   Tier 2 — Full reload. Reserved for cases re-bootstrap can't
 *            handle (page-entry restructuring, SSR-shape changes,
 *            new pages added). Broadcasts `full-reload`.
 *
 * Returns the resolved tier so the caller can gate bundle
 * scheduling — Tier 0 lets the bundle rebuild run async because
 * the running app already has the new behavior; Tier 1+ must wait
 * for the bundle so the re-bootstrap fetches fresh code. */

export type AngularHmrTier = 0 | 1 | 2;

type SurgicalEntry = { id: string; className: string };

type AngularHmrVerdict =
	| { tier: 0; queue: SurgicalEntry[] }
	| { tier: 1; reason: string }
	| { tier: 2; reason: string };

/* Decide the dispatch tier without broadcasting. Pure decision —
 * the caller chooses whether to broadcast immediately (Tier 0,
 * bundle-async safe) or wait for the bundle rebuild first
 * (Tier 1+, the client will dynamic-import a fresh URL).
 *
 * Cost: ~5–10ms per affected component for `tryFastHmr` (single-
 * file parse + fingerprint check). Two orders of magnitude under
 * the bundle rebuild cost so we always run this first. */
const decideAngularTier = async (
	state: HMRState,
	angularDir: string
): Promise<AngularHmrVerdict> => {
	const userEdited = state.lastUserEditedFiles ?? new Set<string>();
	if (userEdited.size === 0) return { queue: [], tier: 0 };

	const { resolveOwningComponents } = await import(
		'./angular/resolveOwningComponents'
	);
	const { encodeHmrComponentId } = await import('./angular/hmrCompiler');
	const { tryFastHmr } = await import('./angular/fastHmrCompiler');

	const queue: SurgicalEntry[] = [];
	const queueIds = new Set<string>();

	for (const editedFile of userEdited) {
		const owners = resolveOwningComponents({
			changedFilePath: editedFile,
			userAngularRoot: angularDir
		});
		if (owners.length === 0 && editedFile.endsWith('.component.ts')) {
			return {
				reason: `no @Component class found in ${editedFile}`,
				tier: 1
			};
		}
		for (const { componentFilePath, className } of owners) {
			const id = encodeHmrComponentId(componentFilePath, className);
			if (queueIds.has(id)) continue;

			const result = await tryFastHmr({ className, componentFilePath });
			if (!result.ok) {
				return {
					reason: `${className}: ${result.reason}${
						result.detail ? ` (${result.detail})` : ''
					}`,
					tier: 1
				};
			}
			queueIds.add(id);
			queue.push({ className, id });
		}
	}

	return { queue, tier: 0 };
};

const broadcastSurgical = (state: HMRState, queue: SurgicalEntry[]): void => {
	const timestamp = Date.now();
	for (const { id, className } of queue) {
		broadcastToClients(state, {
			data: { id, timestamp },
			type: 'angular:component-update'
		});
		logInfo(`[ng-hmr broadcast] ${className}`);
	}
};

const broadcastRebootstrap = async (
	state: HMRState,
	reason: string
): Promise<void> => {
	logInfo(`[ng-hmr tier-1 rebootstrap] ${reason}`);
	broadcastToClients(state, {
		data: {
			manifest: state.manifest,
			reason,
			timestamp: Date.now()
		},
		type: 'angular:rebootstrap'
	});
	// Tier 1 fingerprint invalidation — the running app's structure
	// is now whatever the rebuilt bundle has, so the next surgical
	// attempt should re-baseline from the post-rebootstrap source.
	const { invalidateFingerprintCache } = await import(
		'./angular/fastHmrCompiler'
	);
	invalidateFingerprintCache();
};

const compileAndBundleAngular = async (
	state: HMRState,
	pageEntries: string[],
	angularDir: string
) => {
	const { compileAngular } = await import('../build/compileAngular');
	const { clientPaths, serverPaths } = await compileAngular(
		pageEntries,
		angularDir,
		true,
		getStyleTransformConfig(state.config)
	);

	// SURGICAL_HMR §3.2 — shadow-run AOT-incremental compile alongside
	// the JIT page-chunk emit so the `/@ng/component?c=<id>` endpoint
	// has a program to query. The JIT path still produces the page
	// chunks for now; once §3.3 lands (`_HmrLoad` listener + WS
	// broadcast) the AOT pipeline supersedes JIT and we delete the
	// shadow-run. Failures here are non-fatal — they break surgical
	// HMR for the next edit but don't break the existing reboot path.
	try {
		const { compileAngularForHmr } = await import(
			'./angular/hmrCompiler'
		);
		// Tell ngtsc which resource files (CSS / HTML) changed so the
		// incremental analyzer re-reads them; without this it trusts
		// the previous program's cached metadata and emits stale
		// styles/templates.
		await compileAngularForHmr(
			pageEntries,
			state.resolvedPaths.buildDir,
			state.lastUserEditedFiles ?? null
		);
	} catch (err) {
		logWarn(
			`[hmr] surgical-HMR shadow compile skipped: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
	}

	// SSR loads compileAngular's raw output directly because the HMR fast
	// path skips the bun.build server pass that would normally rewrite
	// `@angular/*` specifiers (without rewriting, SSR resolves the unlinked
	// node_modules copy and trips NG0201 from partial-AOT class drift). But
	// the same raw file is also the input to bundleAngularClient via the
	// hydration wrapper's relative `import * as pageModule` — and Bun's
	// `external: ['@angular/*']` only matches bare specifiers, so rewriting
	// the original in place would let Bun follow the resulting relative
	// path to the server-target Angular vendor and inline the whole thing
	// into the client bundle. The page would then ship its own copy of
	// @angular/core's DI primitives while vendor's R3Injector wrote to a
	// different copy, producing NG0203 on hydration. So write SSR-rewritten
	// content to a sibling `.ssr.js` and point the manifest at it; the
	// original file stays bare-specifier for the client bundle.
	const { getAngularServerVendorPaths } = await import(
		'../core/devVendorPaths'
	);
	const angServerVendorPaths = getAngularServerVendorPaths();
	const ssrPaths = angServerVendorPaths
		? serverPaths.map((serverPath) =>
				serverPath.replace(/\.js$/, '.ssr.js')
			)
		: serverPaths;
	if (serverPaths.length > 0 && angServerVendorPaths) {
		const { copyFile } = await import('node:fs/promises');
		const { rewriteImports } = await import('../build/rewriteImports');
		await Promise.all(
			serverPaths.map((serverPath, idx) => {
				const ssrPath = ssrPaths[idx];
				if (!ssrPath) return Promise.resolve();

				return copyFile(serverPath, ssrPath);
			})
		);
		await rewriteImports(ssrPaths, angServerVendorPaths);
	}

	serverPaths.forEach((serverPath, idx) => {
		const fileBase = basename(serverPath, '.js');
		const ssrPath = ssrPaths[idx] ?? serverPath;
		state.manifest[toPascal(fileBase)] = resolve(ssrPath);
	});

	if (clientPaths.length > 0) {
		await bundleAngularClient(
			state,
			clientPaths,
			state.resolvedPaths.buildDir,
			angularDir
		);
	}
};

const handleAngularFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	const angularDir = config.angularDirectory ?? '';
	const angularFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'angular'
	);

	// Update hashes so duplicate watcher events are filtered
	for (const file of angularFiles) {
		state.fileHashes.set(resolve(file), computeFileHash(file));
	}

	const angularPagesPath = resolve(angularDir, 'pages');
	const pageEntries = resolveAngularPageEntries(
		state,
		angularFiles,
		angularPagesPath
	);

	// Decide tier BEFORE bundling. Tier 0 means we can broadcast
	// the surgical update immediately and let the bundle rebuild
	// run async — the running browser app already received the new
	// component def via `ɵɵreplaceMetadata`, so the bundle is only
	// needed for the next full reload (rare). Tier 1+ requires the
	// fresh bundle URL in hand before broadcasting because the
	// client dynamic-imports it.
	const verdict = await decideAngularTier(state, angularDir);

	const runBundle = async () => {
		if (pageEntries.length === 0) return;
		await compileAndBundleAngular(state, pageEntries, angularDir);
		markSsrCacheDirty('angular');
	};

	if (verdict.tier === 0) {
		broadcastSurgical(state, verdict.queue);
		// Fire-and-forget — bundle rebuild happens in the background
		// while the user continues editing. Errors are swallowed by
		// the void; future Tier 1 escalations will surface them
		// when they need the fresh bundle.
		void runBundle().catch((err) => {
			logWarn(
				`[ng-hmr async bundle] rebuild failed: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		});
	} else {
		// Tier 1+ — must wait for bundle so the rebootstrap fetches
		// fresh code. This is the slow path; it's the equivalent of
		// what `compileAndBundleAngular` cost on every edit before
		// the surgical fast path existed.
		await runBundle();
		await broadcastRebootstrap(state, verdict.reason);
	}

	const { manifest } = state;

	onRebuildComplete({ hmrState: state, manifest });

	return manifest;
};

// O(1) HMR: invalidate cache, pre-transpile the changed file,
// and return the /@src/ URL. Pre-warming ensures the browser fetch
// hits a warm cache. Used by React and Vue (component-level swap).
const getModuleUrl = async (pageFile: string) => {
	const { invalidateModule, warmCache, SRC_URL_PREFIX } = await import(
		'../dev/moduleServer'
	);
	invalidateModule(pageFile);
	const rel = relative(process.cwd(), pageFile).replace(/\\/g, '/');
	const url = `${SRC_URL_PREFIX}${rel}`;
	warmCache(url);

	return url;
};

const getReactModuleUrl = getModuleUrl;

// Svelte: invalidate changed files, resolve the PAGE component,
// and return an /@hmr/ URL that bootstraps the full page remount.
// (Svelte lacks a component-level HMR runtime like React/Vue.)

const resolveBroadcastTarget = async (primaryFile: string) => {
	const isComponentFile =
		primaryFile.endsWith('.tsx') || primaryFile.endsWith('.jsx');

	if (isComponentFile) return primaryFile;

	const { findNearestComponent } = await import('./transformCache');
	const nearest = findNearestComponent(resolve(primaryFile));

	return nearest ?? primaryFile;
};

const handleReactModuleServerPath = async (
	state: HMRState,
	reactFiles: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	// Update hashes so duplicate watcher events are filtered
	for (const file of reactFiles) {
		state.fileHashes.set(resolve(file), computeFileHash(file));
	}

	markSsrCacheDirty('react');

	const primaryFile =
		reactFiles.find(
			(file) => !file.replace(/\\/g, '/').includes('/pages/')
		) ?? reactFiles[0];

	if (!primaryFile) {
		onRebuildComplete({
			hmrState: state,
			manifest: state.manifest
		});

		return state.manifest;
	}

	// Invalidate changed files + direct importers in transform cache
	const { invalidateModule } = await getModuleServer();
	for (const file of reactFiles) {
		invalidateModule(file);
	}

	const broadcastTarget = await resolveBroadcastTarget(primaryFile);
	const pageModuleUrl = await getReactModuleUrl(broadcastTarget);

	if (pageModuleUrl) {
		const serverDuration = Date.now() - startTime;
		state.lastHmrPath = relative(process.cwd(), primaryFile).replace(
			/\\/g,
			'/'
		);
		state.lastHmrFramework = 'react';

		broadcastToClients(state, {
			data: {
				framework: 'react',
				hasComponentChanges: true,
				hasCSSChanges: false,
				manifest: state.manifest,
				pageModuleUrl,
				primarySource: primaryFile,
				serverDuration,
				sourceFiles: reactFiles
			},
			type: 'react-update'
		});
	}

	onRebuildComplete({
		hmrState: state,
		manifest: state.manifest
	});

	return state.manifest;
};

const handleReactFastPath = async (
	state: HMRState,
	_config: BuildConfig,
	filesToRebuild: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	// O(1) HMR: serve the changed file via the module server. The
	// browser re-imports the single module and React Fast Refresh
	// swaps the component in place. There is no Bun.build() fallback
	// here — a full re-bundle on each edit is far too slow for HMR,
	// and the per-file path is correct on patched Bun (PR #28312).
	// On stock Bun, reactFastRefresh is silently ignored and the
	// browser falls back to a full reload; moduleServer logs a
	// one-shot warning in that case.
	const reactFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'react'
	);

	if (reactFiles.length === 0) {
		onRebuildComplete({ hmrState: state, manifest: state.manifest });

		return state.manifest;
	}

	// Lazy import — keep static imports out of this file (HMR rule) and
	// avoid paying for the lookup on non-React HMR cycles.
	const { warnIfReactFastRefreshUnsupported } = await import(
		'./moduleServer'
	);
	warnIfReactFastRefreshUnsupported();

	return handleReactModuleServerPath(
		state,
		reactFiles,
		startTime,
		onRebuildComplete
	);
};

const handleServerManifestUpdate = (
	state: HMRState,
	serverResult: Awaited<ReturnType<typeof import('bun').build>> | undefined
) => {
	if (!serverResult?.success) {
		return;
	}

	serverResult.outputs.forEach((artifact) => {
		updateServerManifestEntry(state, artifact);
	});
};

const handleClientManifestUpdate = async (
	state: HMRState,
	clientResult: Awaited<ReturnType<typeof import('bun').build>> | undefined,
	buildDir: string
) => {
	if (!clientResult?.success) {
		return;
	}

	const { generateManifest } = await import('../build/generateManifest');
	const clientManifest = generateManifest(clientResult.outputs, buildDir);
	Object.assign(state.manifest, clientManifest);
	await populateAssetStore(state.assetStore, clientManifest, buildDir);
};

const broadcastSvelteModuleUpdate = async (
	state: HMRState,
	changedFile: string,
	svelteFiles: string[],
	serverDuration: number
) => {
	const pageModuleUrl = await getModuleUrl(changedFile);
	state.lastHmrPath = changedFile;
	state.lastHmrFramework = 'svelte';

	broadcastToClients(state, {
		data: {
			framework: 'svelte',
			manifest: state.manifest,
			pageModuleUrl,
			serverDuration,
			sourceFile: changedFile,
			sourceFiles: svelteFiles,
			updateType: 'full'
		},
		type: 'svelte-update'
	});
};

const handleSvelteModuleServerPath = async (
	state: HMRState,
	svelteFiles: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	for (const file of svelteFiles) {
		state.fileHashes.set(resolve(file), computeFileHash(file));
	}

	markSsrCacheDirty('svelte');

	const serverDuration = Date.now() - startTime;

	await runSequentially(svelteFiles, (changedFile) =>
		broadcastSvelteModuleUpdate(
			state,
			changedFile,
			svelteFiles,
			serverDuration
		)
	);

	onRebuildComplete({
		hmrState: state,
		manifest: state.manifest
	});

	return state.manifest;
};

const handleSvelteFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	const svelteDir = config.svelteDirectory ?? '';

	const svelteFiles = filesToRebuild.filter(
		(file) =>
			(file.endsWith('.svelte') || file.includes('.svelte.')) &&
			detectFramework(file, state.resolvedPaths) === 'svelte'
	);

	// O(1) fast path: Svelte 5's $.hmr() swaps components in place.
	// Handles ALL changed files — invalidate each, broadcast each.
	if (svelteFiles.length > 0) {
		return handleSvelteModuleServerPath(
			state,
			svelteFiles,
			startTime,
			onRebuildComplete
		);
	}

	// Bundled fallback
	const { buildDir } = state.resolvedPaths;

	if (svelteFiles.length > 0) {
		const { compileSvelte } = await import('../build/compileSvelte');
		const { build: bunBuild } = await import('bun');
		const clientRoot = await computeClientRoot(state.resolvedPaths);

		const { svelteServerPaths, svelteIndexPaths, svelteClientPaths } =
			await compileSvelte(
				svelteFiles,
				svelteDir,
				new Map(),
				true,
				getStyleTransformConfig(state.config)
			);

		const serverEntries = [...svelteServerPaths];
		const clientEntries = [...svelteIndexPaths, ...svelteClientPaths];

		const { getFrameworkGeneratedDir } = await import(
			'../utils/generatedDir'
		);
		const serverRoot = resolve(
			getFrameworkGeneratedDir('svelte'),
			'server'
		);
		const serverOutDir = resolve(buildDir, basename(svelteDir));

		const [serverResult, clientResult] = await Promise.all([
			serverEntries.length > 0
				? bunBuild({
						entrypoints: serverEntries,
						external: [
							'react',
							'react/*',
							'react-dom',
							'react-dom/*',
							'svelte',
							'svelte/*'
						],
						format: 'esm',
						naming: '[dir]/[name].[hash].[ext]',
						outdir: serverOutDir,
						plugins: [
							createStylePreprocessorPlugin(
								getStyleTransformConfig(state.config)
							)
						],
						root: serverRoot,
						target: 'bun',
						throw: false
					})
				: undefined,
			clientEntries.length > 0
				? bunBuild({
						entrypoints: clientEntries,
						format: 'esm',
						naming: '[dir]/[name].[hash].[ext]',
						outdir: buildDir,
						plugins: [
							createStylePreprocessorPlugin(
								getStyleTransformConfig(state.config)
							)
						],
						root: clientRoot,
						target: 'browser',
						throw: false
					})
				: undefined
		]);

		handleServerManifestUpdate(state, serverResult);
		await handleClientManifestUpdate(state, clientResult, buildDir);
	}

	const { manifest } = state;
	const duration = Date.now() - startTime;

	const broadcastFiles =
		svelteFiles.length > 0 ? svelteFiles : filesToRebuild;
	broadcastFiles.forEach((sveltePagePath) => {
		const fileName = basename(sveltePagePath);
		const baseName = fileName.replace(/\.svelte$/, '');
		const pascalName = toPascal(baseName);
		const cssKey = `${pascalName}CSS`;
		const cssUrl = manifest[cssKey] || null;

		logHmrUpdate(sveltePagePath, 'svelte', duration);
		broadcastToClients(state, {
			data: {
				cssBaseName: baseName,
				cssUrl,
				framework: 'svelte',
				html: null,
				manifest,
				sourceFile: sveltePagePath,
				updateType: 'full'
			},
			type: 'svelte-update'
		});
	});

	onRebuildComplete({ hmrState: state, manifest });

	return manifest;
};

const collectAffectedVueFiles = (
	state: HMRState,
	nonVueFiles: string[],
	vueFiles: string[]
) => {
	for (const tsFile of nonVueFiles) {
		const affected = getAffectedFiles(state.dependencyGraph, tsFile);
		const newVueDeps = affected.filter(
			(dep) => dep.endsWith('.vue') && !vueFiles.includes(dep)
		);
		vueFiles.push(...newVueDeps);
	}
};

const invalidateNonVueModules = async (nonVueFiles: string[]) => {
	if (nonVueFiles.length === 0) return;

	const { invalidateModule } = await getModuleServer();
	for (const file of nonVueFiles) {
		invalidateModule(file);
	}
};

const broadcastVueModuleUpdate = async (
	state: HMRState,
	changedFile: string,
	vueFiles: string[],
	nonVueFiles: string[],
	forceReload: boolean,
	serverDuration: number
) => {
	const pageModuleUrl = await getModuleUrl(changedFile);
	// Log the actual changed file — the composable, not the page
	const [firstNonVue] = nonVueFiles;
	state.lastHmrPath =
		nonVueFiles.length > 0 && firstNonVue ? firstNonVue : changedFile;
	state.lastHmrFramework = 'vue';

	broadcastToClients(state, {
		data: {
			changeType: 'full',
			forceReload,
			framework: 'vue',
			manifest: state.manifest,
			pageModuleUrl,
			serverDuration,
			sourceFile: changedFile,
			sourceFiles: vueFiles,
			updateType: 'full'
		},
		type: 'vue-update'
	});
};

const handleVueModuleServerPath = async (
	state: HMRState,
	vueFiles: string[],
	nonVueFiles: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	for (const file of [...vueFiles, ...nonVueFiles]) {
		state.fileHashes.set(resolve(file), computeFileHash(file));
	}

	markSsrCacheDirty('vue');

	// Also invalidate non-Vue files (composables) so the module
	// server serves the fresh version when the component re-imports.
	await invalidateNonVueModules(nonVueFiles);

	const serverDuration = Date.now() - startTime;

	// If triggered by a composable change, force reload so setup re-runs
	const forceReload = nonVueFiles.length > 0;

	await runSequentially(vueFiles, (changedFile) =>
		broadcastVueModuleUpdate(
			state,
			changedFile,
			vueFiles,
			nonVueFiles,
			forceReload,
			serverDuration
		)
	);

	onRebuildComplete({
		hmrState: state,
		manifest: state.manifest
	});

	return state.manifest;
};

const handleVueFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	const vueFiles = filesToRebuild.filter(
		(file) =>
			file.endsWith('.vue') &&
			detectFramework(file, state.resolvedPaths) === 'vue'
	);

	// For non-.vue files (composables, utilities) in the Vue directory,
	// find importing .vue files via the dependency graph and reload those.
	const nonVueFiles = filesToRebuild.filter(
		(file) =>
			!file.endsWith('.vue') &&
			detectFramework(file, state.resolvedPaths) === 'vue'
	);
	collectAffectedVueFiles(state, nonVueFiles, vueFiles);

	// O(1) fast path: Vue HMR runtime swaps components in place.
	// Handles ALL changed files in the batch.
	if (vueFiles.length > 0) {
		return handleVueModuleServerPath(
			state,
			vueFiles,
			nonVueFiles,
			startTime,
			onRebuildComplete
		);
	}

	// Bundled fallback
	onRebuildComplete({ hmrState: state, manifest: state.manifest });

	return state.manifest;
};

const EMBER_PAGE_EXTENSIONS = ['.gts', '.gjs', '.ts', '.js'] as const;

const collectAllEmberPages = async (emberPagesPath: string) => {
	const { readdir } = await import('node:fs/promises');
	try {
		const entries = await readdir(emberPagesPath, {
			recursive: true,
			withFileTypes: true
		});

		return entries
			.filter(
				(entry) =>
					entry.isFile() &&
					EMBER_PAGE_EXTENSIONS.some((ext) =>
						entry.name.endsWith(ext)
					)
			)
			.map((entry) => resolve(emberPagesPath, entry.name));
	} catch {
		return [];
	}
};

const handleEmberFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	const emberDir = config.emberDirectory ?? '';
	const emberFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'ember'
	);

	if (emberFiles.length === 0 || !emberDir) {
		onRebuildComplete({ hmrState: state, manifest: state.manifest });

		return state.manifest;
	}

	// Update hashes so duplicate watcher events filter cleanly.
	for (const file of emberFiles) {
		state.fileHashes.set(resolve(file), computeFileHash(file));
	}

	// Recompile pages whose bundle includes the edited file. compileEmber
	// re-emits self-contained server bundles into
	// <emberDir>/generated/server/<Name>.js (a stable path the manifest
	// already points to from the initial build), so we just need to mark
	// SSR dirty + bust the page handler's import cache. The browser then
	// does a full reload and gets the fresh HTML.
	//
	// Page-level granularity: edits to a non-page file (e.g. a shared
	// component) currently rebuild every page, since Phase 1.5 doesn't
	// track which page imports which component. Phase 3 will narrow this
	// via dependency-graph lookup.
	const emberPagesPath = resolve(emberDir, 'pages');
	const directPageEntries = emberFiles.filter((file) =>
		resolve(file).startsWith(emberPagesPath)
	);
	const allPageEntries =
		directPageEntries.length > 0
			? directPageEntries
			: await collectAllEmberPages(emberPagesPath);

	if (allPageEntries.length === 0) {
		onRebuildComplete({ hmrState: state, manifest: state.manifest });

		return state.manifest;
	}

	const { compileEmber } = await import('../build/compileEmber');
	const { serverPaths } = await compileEmber(
		allPageEntries,
		emberDir,
		process.cwd(),
		true
	);

	for (const serverPath of serverPaths) {
		const fileBase = basename(serverPath, '.js');
		state.manifest[toPascal(fileBase)] = resolve(serverPath);
	}

	const { invalidateEmberSsrCache } = await import('../ember');
	invalidateEmberSsrCache();

	const duration = Date.now() - startTime;
	const [primary] = emberFiles;
	if (primary) {
		state.lastHmrPath = relative(process.cwd(), primary).replace(
			/\\/g,
			'/'
		);
		state.lastHmrFramework = 'ember';
		logHmrUpdate(primary, 'ember', duration);
	}

	// Phase 1.5 ships full-reload HMR only — Glimmer state is lost on
	// reload, but the edit-save-see-it-update loop works. Phase 3 will
	// add component-level swap with @tracked state preservation.
	broadcastToClients(state, {
		data: {
			affectedPages: allPageEntries,
			manifest: state.manifest
		},
		type: 'full-reload'
	});

	onRebuildComplete({ hmrState: state, manifest: state.manifest });

	return state.manifest;
};

const collectModuleUpdatesForFramework = (
	framework: string,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	state: HMRState
) => {
	const frameworkFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === framework
	);

	if (frameworkFiles.length === 0) {
		return [];
	}

	return createModuleUpdates(
		frameworkFiles,
		framework,
		manifest,
		state.resolvedPaths
	);
};

const collectAllModuleUpdates = (
	affectedFrameworks: string[],
	filesToRebuild: string[],
	manifest: Record<string, string>,
	state: HMRState
) => {
	const allModuleUpdates: ModuleUpdate[] = [];

	affectedFrameworks.forEach((framework) => {
		const moduleUpdates = collectModuleUpdatesForFramework(
			framework,
			filesToRebuild,
			manifest,
			state
		);
		moduleUpdates.forEach((update) => {
			if (update) {
				allModuleUpdates.push(update);
			}
		});
	});

	return allModuleUpdates;
};

const handleReactHMR = (
	state: HMRState,
	affectedFrameworks: string[],
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (
		!affectedFrameworks.includes('react') ||
		!state.resolvedPaths.reactDir
	) {
		return;
	}

	const reactFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'react'
	);

	if (reactFiles.length === 0) {
		return;
	}

	const reactPageFiles = reactFiles.filter((file) =>
		file.replace(/\\/g, '/').includes('/pages/')
	);
	const sourceFiles = reactPageFiles.length > 0 ? reactPageFiles : reactFiles;
	const [primarySource] = sourceFiles;

	try {
		const hasComponentChanges = reactFiles.some(
			(file) =>
				file.endsWith('.tsx') ||
				file.endsWith('.ts') ||
				file.endsWith('.jsx')
		);
		const hasCSSChanges = reactFiles.some(isStylePath);

		logHmrUpdate(primarySource ?? reactFiles[0] ?? '', 'react', duration);

		broadcastToClients(state, {
			data: {
				framework: 'react',
				hasComponentChanges: hasComponentChanges,
				hasCSSChanges: hasCSSChanges,
				manifest,
				primarySource,
				sourceFiles
			},
			type: 'react-update'
		});
	} catch (err) {
		sendTelemetryEvent('hmr:error', {
			framework: 'react',
			message: err instanceof Error ? err.message : String(err)
		});
	}
};

const handleScriptUpdate = (
	state: HMRState,
	scriptFile: string,
	manifest: Record<string, string>,
	framework: string,
	duration: number
) => {
	const scriptBaseName = basename(scriptFile).replace(
		/\.(ts|js|tsx|jsx)$/,
		''
	);
	const pascalName = toPascal(scriptBaseName);
	const scriptPath = manifest[pascalName] || null;

	if (!scriptPath) {
		logWarn(`Script not found in manifest: ${pascalName}`);

		return;
	}

	logScriptUpdate(scriptFile, framework, duration);
	broadcastToClients(state, {
		data: {
			framework,
			manifest,
			scriptPath,
			sourceFile: scriptFile
		},
		type: 'script-update'
	});
};

const isScriptFile = (file: string) =>
	(file.endsWith('.ts') ||
		file.endsWith('.js') ||
		file.endsWith('.tsx') ||
		file.endsWith('.jsx')) &&
	file.replace(/\\/g, '/').includes('/scripts/');

const resolveIslandDefinitionSource = (
	definition: { buildReference: { source: string } | null },
	buildInfo: { resolvedRegistryPath: string },
	islandFiles: Set<string>
) => {
	const { buildReference } = definition;
	if (!buildReference?.source) {
		return;
	}

	const sourcePath = buildReference.source.startsWith('file://')
		? new URL(buildReference.source).pathname
		: resolve(
				dirname(buildInfo.resolvedRegistryPath),
				buildReference.source
			);
	islandFiles.add(resolve(sourcePath));
};

const resolveIslandSourceFiles = async (config: BuildConfig) => {
	const registryPath = config.islands?.registry;
	if (!registryPath) {
		return new Set<string>();
	}

	const buildInfo = await loadIslandRegistryBuildInfo(registryPath);
	const islandFiles = new Set<string>([
		resolve(buildInfo.resolvedRegistryPath)
	]);

	for (const definition of buildInfo.definitions) {
		resolveIslandDefinitionSource(definition, buildInfo, islandFiles);
	}

	return islandFiles;
};

const didStaticPagesNeedIslandRefresh = async (
	config: BuildConfig,
	filesToRebuild: string[]
) => {
	const islandFiles = await resolveIslandSourceFiles(config);
	if (islandFiles.size === 0) {
		return false;
	}

	return filesToRebuild.some((file) => islandFiles.has(resolve(file)));
};

const handleIslandSourceReload = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	manifest: Record<string, string>
) => {
	const shouldReload = await didStaticPagesNeedIslandRefresh(
		config,
		filesToRebuild
	);
	if (!shouldReload) {
		return false;
	}

	setCurrentPageIslandMetadata(await loadPageIslandMetadata(config));
	const affectedPages = filesToRebuild.flatMap((file) =>
		getPagesUsingIslandSource(file)
	);

	broadcastToClients(state, {
		data: {
			affectedPages,
			manifest
		},
		type: 'full-reload'
	});

	return true;
};

const handleHTMLScriptHMR = (
	state: HMRState,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!state.resolvedPaths.htmlDir) {
		return;
	}

	const htmlFrameworkFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'html'
	);

	if (htmlFrameworkFiles.length === 0) {
		return;
	}

	const scriptFiles = htmlFrameworkFiles.filter(isScriptFile);
	const htmlPageFiles = htmlFrameworkFiles.filter((file) =>
		file.endsWith('.html')
	);

	if (scriptFiles.length === 0 || htmlPageFiles.length > 0) {
		return;
	}

	scriptFiles.forEach((scriptFile) => {
		handleScriptUpdate(state, scriptFile, manifest, 'html', duration);
	});
};

const computeOutputPagesDir = (
	state: HMRState,
	config: BuildConfig,
	framework: 'html' | 'htmx'
) => {
	const isSingle =
		!config.reactDirectory &&
		!config.svelteDirectory &&
		!config.vueDirectory &&
		(framework === 'html' ? !config.htmxDirectory : !config.htmlDirectory);

	if (isSingle) {
		return resolve(state.resolvedPaths.buildDir, 'pages');
	}

	const dirName =
		framework === 'html'
			? basename(config.htmlDirectory ?? 'html')
			: basename(config.htmxDirectory ?? 'htmx');

	return resolve(state.resolvedPaths.buildDir, dirName, 'pages');
};

const processHtmlPageUpdate = async (
	state: HMRState,
	pageFile: string,
	builtHtmlPagePath: string,
	manifest: Record<string, string>,
	duration: number
) => {
	try {
		const { handleHTMLUpdate } = await import('./simpleHTMLHMR');
		const newHTML = await handleHTMLUpdate(builtHtmlPagePath);

		if (!newHTML) {
			return;
		}

		logHmrUpdate(pageFile, 'html', duration);
		broadcastToClients(state, {
			data: {
				framework: 'html',
				html: newHTML,
				manifest,
				sourceFile: builtHtmlPagePath
			},
			type: 'html-update'
		});
	} catch (err) {
		sendTelemetryEvent('hmr:error', {
			framework: 'html',
			message: err instanceof Error ? err.message : String(err)
		});
	}
};

const handleHTMLPageHMR = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!state.resolvedPaths.htmlDir) {
		return;
	}

	const shouldRefreshFromIslandChange = await didStaticPagesNeedIslandRefresh(
		config,
		filesToRebuild
	);
	const htmlFrameworkFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'html'
	);

	if (htmlFrameworkFiles.length === 0 && !shouldRefreshFromIslandChange) {
		return;
	}

	const htmlPageFiles = htmlFrameworkFiles.filter((file) =>
		file.endsWith('.html')
	);
	const outputHtmlPages = computeOutputPagesDir(state, config, 'html');
	const shouldRefreshAllPages =
		htmlPageFiles.length === 0 && shouldRefreshFromIslandChange;
	const pageFilesToUpdate = shouldRefreshAllPages
		? await scanEntryPoints(outputHtmlPages, '*.html')
		: htmlPageFiles;

	await runSequentially(pageFilesToUpdate, async (pageFile) => {
		const htmlPageName = basename(pageFile);
		const builtHtmlPagePath = resolve(outputHtmlPages, htmlPageName);
		await processHtmlPageUpdate(
			state,
			pageFile,
			builtHtmlPagePath,
			manifest,
			duration
		);
	});
};

const handleVueCssOnlyUpdate = (
	state: HMRState,
	vueCssFiles: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	const [cssFile] = vueCssFiles;
	if (!cssFile) {
		return;
	}

	const cssBaseName = basename(getStyleBaseName(cssFile));
	const cssPascalName = toPascal(cssBaseName);
	const cssKey = `${cssPascalName}CSS`;
	const cssUrl = manifest[cssKey] || null;

	logCssUpdate(cssFile, 'vue', duration);
	broadcastToClients(state, {
		data: {
			cssBaseName,
			cssUrl,
			framework: 'vue',
			manifest,
			sourceFile: cssFile,
			updateType: 'css-only'
		},
		type: 'vue-update'
	});
};

const broadcastVueStyleOnly = (
	state: HMRState,
	vuePagePath: string,
	baseName: string,
	cssUrl: string | null,
	hmrId: string,
	manifest: Record<string, string>,
	duration: number
) => {
	logCssUpdate(vuePagePath, 'vue', duration);
	broadcastToClients(state, {
		data: {
			changeType: 'style-only',
			cssBaseName: baseName,
			cssUrl,
			framework: 'vue',
			hmrId,
			manifest,
			sourceFile: vuePagePath,
			updateType: 'css-only'
		},
		type: 'vue-update'
	});
};

const broadcastVueFullUpdate = (
	state: HMRState,
	vuePagePath: string,
	changeType: string,
	cssUrl: string | null,
	hmrId: string,
	manifest: Record<string, string>,
	pascalName: string,
	duration: number
) => {
	const componentPath = manifest[`${pascalName}Client`] || null;

	logHmrUpdate(vuePagePath, 'vue', duration);
	broadcastToClients(state, {
		data: {
			changeType,
			componentPath,
			cssUrl,
			framework: 'vue',
			hmrId,
			html: null,
			manifest,
			sourceFile: vuePagePath,
			updateType: 'full'
		},
		type: 'vue-update'
	});
};

const broadcastVuePageChange = async (
	state: HMRState,
	config: BuildConfig,
	vuePagePath: string,
	manifest: Record<string, string>,
	duration: number
) => {
	const fileName = basename(vuePagePath);
	const baseName = fileName.replace(/\.vue$/, '');
	const pascalName = toPascal(baseName);

	const vueRoot = config.vueDirectory;
	const hmrId = vueRoot
		? relative(vueRoot, vuePagePath)
				.replace(/\\/g, '/')
				.replace(/\.vue$/, '')
		: baseName;

	const cssKey = `${pascalName}CSS`;
	const cssUrl = manifest[cssKey] || null;

	const { vueHmrMetadata } = await import('../build/compileVue');
	const hmrMeta = vueHmrMetadata.get(resolve(vuePagePath));
	const changeType = hmrMeta?.changeType ?? 'full';

	if (changeType === 'style-only') {
		broadcastVueStyleOnly(
			state,
			vuePagePath,
			baseName,
			cssUrl,
			hmrId,
			manifest,
			duration
		);

		return;
	}

	broadcastVueFullUpdate(
		state,
		vuePagePath,
		changeType,
		cssUrl,
		hmrId,
		manifest,
		pascalName,
		duration
	);
};

const processVuePageUpdate = async (
	state: HMRState,
	config: BuildConfig,
	vuePagePath: string,
	manifest: Record<string, string>,
	duration: number
) => {
	try {
		await broadcastVuePageChange(
			state,
			config,
			vuePagePath,
			manifest,
			duration
		);
	} catch (err) {
		sendTelemetryEvent('hmr:error', {
			framework: 'vue',
			message: err instanceof Error ? err.message : String(err)
		});
	}
};

const handleVueHMR = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!config.vueDirectory) {
		return;
	}

	const vueFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'vue'
	);

	if (vueFiles.length === 0) {
		return;
	}

	const vueComponentFiles = vueFiles.filter((file) => file.endsWith('.vue'));
	const vueCssFiles = vueFiles.filter(isStylePath);
	const isCssOnlyChange =
		vueComponentFiles.length === 0 && vueCssFiles.length > 0;

	const vuePageFiles = vueFiles.filter((file) =>
		file.replace(/\\/g, '/').includes('/pages/')
	);
	const pagesToUpdate =
		vuePageFiles.length > 0 ? vuePageFiles : vueComponentFiles;

	if (isCssOnlyChange && vueCssFiles.length > 0) {
		handleVueCssOnlyUpdate(state, vueCssFiles, manifest, duration);
	}

	await runSequentially(pagesToUpdate, (vuePagePath) =>
		processVuePageUpdate(state, config, vuePagePath, manifest, duration)
	);
};

const handleSvelteCssOnlyUpdate = (
	state: HMRState,
	svelteCssFiles: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	const [cssFile] = svelteCssFiles;
	if (!cssFile) {
		return;
	}

	const cssBaseName = basename(getStyleBaseName(cssFile));
	const cssPascalName = toPascal(cssBaseName);
	const cssKey = `${cssPascalName}CSS`;
	const cssUrl = manifest[cssKey] || null;

	logCssUpdate(cssFile, 'svelte', duration);
	broadcastToClients(state, {
		data: {
			cssBaseName,
			cssUrl,
			framework: 'svelte',
			manifest,
			sourceFile: cssFile,
			updateType: 'css-only'
		},
		type: 'svelte-update'
	});
};

const broadcastSveltePageUpdate = (
	state: HMRState,
	sveltePagePath: string,
	manifest: Record<string, string>,
	duration: number
) => {
	try {
		const fileName = basename(sveltePagePath);
		const baseName = fileName.replace(/\.svelte$/, '');
		const pascalName = toPascal(baseName);
		const cssKey = `${pascalName}CSS`;
		const cssUrl = manifest[cssKey] || null;

		logHmrUpdate(sveltePagePath, 'svelte', duration);
		broadcastToClients(state, {
			data: {
				cssBaseName: baseName,
				cssUrl,
				framework: 'svelte',
				html: null,
				manifest,
				sourceFile: sveltePagePath,
				updateType: 'full'
			},
			type: 'svelte-update'
		});
	} catch (err) {
		sendTelemetryEvent('hmr:error', {
			framework: 'svelte',
			message: err instanceof Error ? err.message : String(err)
		});
	}
};

const handleSvelteHMR = (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!config.svelteDirectory) {
		return;
	}

	const svelteFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'svelte'
	);

	if (svelteFiles.length === 0) {
		return;
	}

	const svelteComponentFiles = svelteFiles.filter((file) =>
		file.endsWith('.svelte')
	);
	const svelteCssFiles = svelteFiles.filter(isStylePath);
	const isCssOnlyChange =
		svelteComponentFiles.length === 0 && svelteCssFiles.length > 0;

	const sveltePageFiles = svelteFiles.filter((file) =>
		file.replace(/\\/g, '/').includes('/pages/')
	);
	const pagesToUpdate =
		sveltePageFiles.length > 0 ? sveltePageFiles : svelteComponentFiles;

	if (isCssOnlyChange && svelteCssFiles.length > 0) {
		handleSvelteCssOnlyUpdate(state, svelteCssFiles, manifest, duration);
	}

	pagesToUpdate.forEach((sveltePagePath) => {
		broadcastSveltePageUpdate(state, sveltePagePath, manifest, duration);
	});
};

const collectAngularAffectedPages = (
	affected: string[],
	resolvedPages: Set<string>
) => {
	affected.forEach((file) => {
		if (
			file.replace(/\\/g, '/').includes('/pages/') &&
			file.endsWith('.ts')
		) {
			resolvedPages.add(file);
		}
	});
};

const resolveAngularPagesFromDependencyGraph = (
	state: HMRState,
	angularFiles: string[]
) => {
	const resolvedPages = new Set<string>();
	angularFiles.forEach((componentFile) => {
		const lookupFile = resolveComponentLookupFile(
			componentFile,
			state.dependencyGraph
		);
		const affected = getAffectedFiles(state.dependencyGraph, lookupFile);
		collectAngularAffectedPages(affected, resolvedPages);
	});

	return Array.from(resolvedPages);
};

const handleAngularCssOnlyUpdate = (
	state: HMRState,
	angularCssFiles: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	const [cssFile] = angularCssFiles;
	if (!cssFile) {
		return;
	}

	const cssBaseName = basename(getStyleBaseName(cssFile));
	const cssPascalName = toPascal(cssBaseName);
	const cssKey = `${cssPascalName}CSS`;
	const cssUrl = manifest[cssKey] || null;

	logCssUpdate(cssFile, 'angular', duration);
	broadcastToClients(state, {
		data: {
			cssBaseName,
			cssUrl,
			framework: 'angular',
			manifest,
			sourceFile: cssFile,
			updateType: 'style'
		},
		type: 'angular-update'
	});
};

/* Stripped-down post-bundle handler. The proto-swap branch is
 * gone — all component HMR routes through the tiered dispatch in
 * `handleAngularFastPath` (Tier 0 surgical / Tier 1 re-bootstrap).
 * The only path that stays here is global-stylesheet hot-swap for
 * non-component CSS files, which the dependency graph still routes
 * through the angular handler when they're imported by a component. */
const handleAngularHMR = (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!config.angularDirectory) return;

	const angularFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'angular'
	);
	if (angularFiles.length === 0) return;

	const angularCssFiles = angularFiles.filter(isStylePath);
	const isCssOnlyChange =
		angularFiles.every(isStylePath) && angularCssFiles.length > 0;
	if (isCssOnlyChange) {
		handleAngularCssOnlyUpdate(state, angularCssFiles, manifest, duration);
	}
};

const handleHTMXScriptHMR = (
	state: HMRState,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!state.resolvedPaths.htmxDir) {
		return;
	}

	const htmxFrameworkFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'htmx'
	);

	if (htmxFrameworkFiles.length === 0) {
		return;
	}

	const htmxScriptFiles = htmxFrameworkFiles.filter(isScriptFile);
	const htmxHtmlFiles = htmxFrameworkFiles.filter((file) =>
		file.endsWith('.html')
	);

	if (htmxScriptFiles.length === 0 || htmxHtmlFiles.length > 0) {
		return;
	}

	htmxScriptFiles.forEach((scriptFile) => {
		handleScriptUpdate(state, scriptFile, manifest, 'htmx', duration);
	});
};

const processHtmxPageUpdate = async (
	state: HMRState,
	htmxPageFile: string,
	builtHtmxPagePath: string,
	manifest: Record<string, string>,
	duration: number
) => {
	try {
		const { handleHTMXUpdate } = await import('./simpleHTMXHMR');
		const newHTML = await handleHTMXUpdate(builtHtmxPagePath);

		if (!newHTML) {
			return;
		}

		logHmrUpdate(htmxPageFile, 'htmx', duration);
		broadcastToClients(state, {
			data: {
				framework: 'htmx',
				html: newHTML,
				manifest,
				sourceFile: builtHtmxPagePath
			},
			type: 'htmx-update'
		});
	} catch (err) {
		sendTelemetryEvent('hmr:error', {
			framework: 'htmx',
			message: err instanceof Error ? err.message : String(err)
		});
	}
};

const handleHTMXPageHMR = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!state.resolvedPaths.htmxDir) {
		return;
	}

	const shouldRefreshFromIslandChange = await didStaticPagesNeedIslandRefresh(
		config,
		filesToRebuild
	);
	const htmxFrameworkFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'htmx'
	);

	if (htmxFrameworkFiles.length === 0 && !shouldRefreshFromIslandChange) {
		return;
	}

	const htmxPageFiles = htmxFrameworkFiles.filter((file) =>
		file.endsWith('.html')
	);
	const outputHtmxPages = computeOutputPagesDir(state, config, 'htmx');
	const shouldRefreshAllPages =
		htmxPageFiles.length === 0 && shouldRefreshFromIslandChange;
	const pageFilesToUpdate = shouldRefreshAllPages
		? await scanEntryPoints(outputHtmxPages, '*.html')
		: htmxPageFiles;

	await runSequentially(pageFilesToUpdate, async (htmxPageFile) => {
		const htmxPageName = basename(htmxPageFile);
		const builtHtmxPagePath = resolve(outputHtmxPages, htmxPageName);
		await processHtmxPageUpdate(
			state,
			htmxPageFile,
			builtHtmxPagePath,
			manifest,
			duration
		);
	});
};

const collectUpdatedModulePaths = (
	allModuleUpdates: Array<{
		sourceFile: string;
		modulePaths: Record<string, string>;
	}>
) => {
	const paths: string[] = [];
	allModuleUpdates.forEach((update) => {
		paths.push(update.sourceFile);
		Object.values(update.modulePaths).forEach((modulePath) => {
			paths.push(modulePath);
		});
	});

	return paths;
};

const buildModuleVersionsForUpdate = (
	update: { sourceFile: string; modulePaths: Record<string, string> },
	moduleVersionsStore: Map<string, number>,
	moduleVersions: Record<string, number>
) => {
	const sourceVersion = moduleVersionsStore.get(update.sourceFile);
	if (sourceVersion !== undefined) {
		moduleVersions[update.sourceFile] = sourceVersion;
	}
	Object.values(update.modulePaths).forEach((path) => {
		const pathVersion = moduleVersionsStore.get(path);
		if (pathVersion !== undefined) {
			moduleVersions[path] = pathVersion;
		}
	});
};

const handleModuleUpdates = (
	state: HMRState,
	allModuleUpdates: ModuleUpdate[],
	manifest: Record<string, string>
) => {
	const updatedModulePaths = collectUpdatedModulePaths(allModuleUpdates);

	if (updatedModulePaths.length > 0) {
		incrementModuleVersions(state.moduleVersions, updatedModulePaths);
	}

	if (allModuleUpdates.length === 0) {
		return;
	}

	const updatesByFramework = groupModuleUpdatesByFramework(allModuleUpdates);
	const serverVersions = serializeModuleVersions(state.moduleVersions);

	for (const [framework, updates] of updatesByFramework) {
		const moduleVersions: Record<string, number> = {};
		updates.forEach((update) => {
			buildModuleVersionsForUpdate(
				update,
				state.moduleVersions,
				moduleVersions
			);
		});

		broadcastToClients(state, {
			data: {
				framework,
				manifest,
				modules: updates.map((update) => ({
					componentType: update.componentType,
					moduleKeys: update.moduleKeys,
					modulePaths: update.modulePaths,
					sourceFile: update.sourceFile,
					version: state.moduleVersions.get(update.sourceFile)
				})),
				moduleVersions: moduleVersions,
				serverVersions: serverVersions
			},
			message: `${framework} modules updated`,
			type: 'module-update'
		});
	}
};

const handleFullBuildHMR = async (
	state: HMRState,
	config: BuildConfig,
	affectedFrameworks: string[],
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	const allModuleUpdates = collectAllModuleUpdates(
		affectedFrameworks,
		filesToRebuild,
		manifest,
		state
	);

	handleReactHMR(
		state,
		affectedFrameworks,
		filesToRebuild,
		manifest,
		duration
	);

	handleHTMLScriptHMR(state, filesToRebuild, manifest, duration);

	await handleHTMLPageHMR(state, config, filesToRebuild, manifest, duration);

	await handleVueHMR(state, config, filesToRebuild, manifest, duration);

	handleSvelteHMR(state, config, filesToRebuild, manifest, duration);

	handleAngularHMR(state, config, filesToRebuild, manifest, duration);

	handleHTMXScriptHMR(state, filesToRebuild, manifest, duration);

	await handleHTMXPageHMR(state, config, filesToRebuild, manifest, duration);

	handleModuleUpdates(state, allModuleUpdates, manifest);
};

const logStyleUpdatesForFramework = (
	state: HMRState,
	framework: string,
	filesToRebuild: string[],
	startTime: number
) => {
	const dur = Date.now() - startTime;
	filesToRebuild.forEach((file) => {
		if (detectFramework(file, state.resolvedPaths) === framework) {
			logCssUpdate(file, framework, dur);
		}
	});
};

const broadcastSingleFrameworkUpdate = (
	state: HMRState,
	framework: string,
	filesToRebuild: string[] | undefined,
	manifest: Record<string, string>,
	startTime: number
) => {
	const type =
		framework === 'styles' || framework === 'assets'
			? 'style-update'
			: 'framework-update';

	if (type === 'style-update' && filesToRebuild) {
		logStyleUpdatesForFramework(
			state,
			framework,
			filesToRebuild,
			startTime
		);
	}
	broadcastToClients(state, {
		data: {
			framework,
			manifest
		},
		message: `${framework} framework updated`,
		type
	});
};

const broadcastFrameworkUpdates = (
	state: HMRState,
	affectedFrameworks: string[],
	filesToRebuild: string[] | undefined,
	manifest: Record<string, string>,
	startTime: number
) => {
	affectedFrameworks.forEach((framework) => {
		broadcastSingleFrameworkUpdate(
			state,
			framework,
			filesToRebuild,
			manifest,
			startTime
		);
	});
};

const HMR_SCRIPT_PATTERN =
	/<script>window\.__HMR_FRAMEWORK__[\s\S]*?<\/script>\s*<script data-hmr-client>[\s\S]*?<\/script>/;

const extractHmrScript = (
	destPath: string,
	readFs: (path: string, encoding: 'utf-8') => string
) => {
	try {
		const existing = readFs(destPath, 'utf-8');
		const [matched] = existing.match(HMR_SCRIPT_PATTERN) ?? [];

		return matched ?? '';
	} catch {
		// built file doesn't exist yet
		return '';
	}
};

const injectHmrScript = (
	destPath: string,
	hmrScript: string,
	readFs: (path: string, encoding: 'utf-8') => string,
	writeFs: (path: string, data: string) => void
) => {
	if (!hmrScript) return;

	let html = readFs(destPath, 'utf-8');
	const bodyClose = /<\/body\s*>/i.exec(html);
	if (!bodyClose) return;

	html =
		html.slice(0, bodyClose.index) +
		hmrScript +
		html.slice(bodyClose.index);
	writeFs(destPath, html);
};

const processMarkupFileFastPath = async (
	state: HMRState,
	sourceFile: string,
	outputDir: string,
	framework: 'html' | 'htmx',
	startTime: number,
	updateAssetPaths: (
		manifest: Record<string, string>,
		dir: string
	) => Promise<void>,
	handleUpdate: (path: string) => Promise<unknown>,
	readFs: (path: string, encoding: 'utf-8') => string,
	writeFs: (path: string, data: string) => void
) => {
	const destPath = resolve(outputDir, basename(sourceFile));

	// Save HMR script from existing built file
	const hmrScript = extractHmrScript(destPath, readFs);

	// Atomic copy: Bun.write ensures content is flushed
	const source = await Bun.file(sourceFile).text();
	await Bun.write(destPath, source);

	// Rewrite asset paths using manifest
	await updateAssetPaths(state.manifest, outputDir);

	// Rewrite <img data-optimized> tags to use the optimization endpoint
	const { optimizeHtmlImages } = await import('../build/optimizeHtmlImages');
	await optimizeHtmlImages(outputDir);

	// Re-inject HMR script
	injectHmrScript(destPath, hmrScript, readFs, writeFs);

	// Read processed file and broadcast body only
	const newHTML = await handleUpdate(destPath);
	if (!newHTML) return;

	const dur = Date.now() - startTime;
	logHmrUpdate(sourceFile, framework, dur);
	broadcastToClients(state, {
		data: {
			framework,
			html: newHTML,
			manifest: state.manifest,
			sourceFile
		},
		type: `${framework}-update`
	});
};

const tryProcessMarkupFile = async (
	state: HMRState,
	sourceFile: string,
	outputDir: string,
	framework: 'html' | 'htmx',
	startTime: number,
	updateAssetPaths: (
		manifest: Record<string, string>,
		dir: string
	) => Promise<void>,
	handleUpdate: (path: string) => Promise<unknown>,
	readFs: (path: string, encoding: 'utf-8') => string,
	writeFs: (path: string, data: string) => void
) => {
	try {
		await processMarkupFileFastPath(
			state,
			sourceFile,
			outputDir,
			framework,
			startTime,
			updateAssetPaths,
			handleUpdate,
			readFs,
			writeFs
		);

		return true;
	} catch {
		// fall through to full rebuild
		return false;
	}
};

const runMarkupFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[] | undefined,
	startTime: number,
	framework: 'html' | 'htmx'
) => {
	const markupFiles = (filesToRebuild ?? []).filter((file) =>
		file.endsWith('.html')
	);

	if (markupFiles.length === 0) return;

	const outputDir = computeOutputPagesDir(state, config, framework);
	const { updateAssetPaths } = await import('../build/updateAssetPaths');
	const handleUpdate =
		framework === 'html'
			? (await import('./simpleHTMLHMR')).handleHTMLUpdate
			: (await import('./simpleHTMXHMR')).handleHTMXUpdate;
	const { readFileSync: readFs, writeFileSync: writeFs } = await import(
		'node:fs'
	);

	const processMarkupFiles = async (files: string[]) => {
		const [markupFile, ...remaining] = files;
		if (!markupFile) {
			return;
		}

		const success = await tryProcessMarkupFile(
			state,
			markupFile,
			outputDir,
			framework,
			startTime,
			updateAssetPaths,
			handleUpdate,
			readFs,
			writeFs
		);
		if (!success) {
			return;
		}

		await processMarkupFiles(remaining);
	};

	await processMarkupFiles(markupFiles);
};

const runHtmlFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[] | undefined,
	startTime: number
) => runMarkupFastPath(state, config, filesToRebuild, startTime, 'html');

const runHtmxFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[] | undefined,
	startTime: number
) => runMarkupFastPath(state, config, filesToRebuild, startTime, 'htmx');

type FrameworkFastPathConfig = {
	directory: string | undefined;
	framework: string;
	handler: (
		state: HMRState,
		config: BuildConfig,
		files: string[],
		startTime: number,
		onRebuildComplete: (result: {
			manifest: Record<string, string>;
			hmrState: HMRState;
		}) => void
	) => Promise<Record<string, string> | undefined>;
};

const markHandledFiles = (
	files: string[],
	framework: string,
	resolvedPaths: ResolvedBuildPaths,
	handled: Set<string>
) => {
	files
		.filter((f) => detectFramework(f, resolvedPaths) === framework)
		.forEach((f) => handled.add(f));
};

const runFrameworkFastPaths = async (
	state: HMRState,
	config: BuildConfig,
	affectedFrameworks: string[],
	files: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	const handled = new Set<string>();

	const fastPaths: FrameworkFastPathConfig[] = [
		{
			directory: config.angularDirectory,
			framework: 'angular',
			handler: handleAngularFastPath
		},
		{
			directory: config.emberDirectory,
			framework: 'ember',
			handler: handleEmberFastPath
		},
		{
			directory: config.reactDirectory,
			framework: 'react',
			handler: handleReactFastPath
		},
		{
			directory: config.svelteDirectory,
			framework: 'svelte',
			handler: handleSvelteFastPath
		},
		{
			directory: config.vueDirectory,
			framework: 'vue',
			handler: handleVueFastPath
		}
	];

	await runSequentially(fastPaths, async (fastPath) => {
		if (
			!fastPath.directory ||
			!affectedFrameworks.includes(fastPath.framework)
		)
			return;

		await fastPath.handler(
			state,
			config,
			files,
			startTime,
			onRebuildComplete
		);
		markHandledFiles(
			files,
			fastPath.framework,
			state.resolvedPaths,
			handled
		);
	});

	// Check if any files weren't handled by a fast path.
	// CSS/styles and copied assets need the full build so outputs stay in sync.
	return files.every((f) => handled.has(f));
};

const performFullRebuild = async (
	state: HMRState,
	config: BuildConfig,
	affectedFrameworks: string[],
	filesToRebuild: string[] | undefined,
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	// Run each framework's fast path for its files independently.
	// This handles cross-framework batches (e.g., editing a React
	// and Svelte file in the same save) without falling through
	// to the full build.
	const hasManifest = Object.keys(state.manifest).length > 0;
	const files = filesToRebuild ?? [];
	let allHandled = files.length > 0 && hasManifest;
	const hasIslandSourceChanges =
		files.length > 0
			? await didStaticPagesNeedIslandRefresh(config, files)
			: false;

	if (allHandled && !hasIslandSourceChanges) {
		allHandled = await runFrameworkFastPaths(
			state,
			config,
			affectedFrameworks,
			files,
			startTime,
			onRebuildComplete
		);
	}

	// HTML fast path
	if (
		allHandled &&
		config.htmlDirectory &&
		affectedFrameworks.includes('html')
	) {
		await runHtmlFastPath(state, config, filesToRebuild, startTime);
	}

	// HTMX fast path
	if (
		allHandled &&
		config.htmxDirectory &&
		affectedFrameworks.includes('htmx')
	) {
		await runHtmxFastPath(state, config, filesToRebuild, startTime);
	}

	// If all frameworks were handled by fast paths, skip the full build —
	// but Tailwind still needs to rescan source files when a candidate
	// changed (the fast path skips the build, which is where Tailwind runs).
	if (allHandled) {
		await recompileTailwindForFastPath(state, config, files);

		onRebuildComplete({
			hmrState: state,
			manifest: state.manifest
		});

		return state.manifest;
	}

	const buildConfig: BuildConfig = {
		...config,
		incrementalFiles:
			filesToRebuild && filesToRebuild.length > 0
				? filesToRebuild
				: undefined,
		options: {
			...config.options,
			baseManifest: state.manifest,
			injectHMR: true,
			throwOnError: true
		}
	};

	const buildResult = await build(buildConfig);

	if (!buildResult?.manifest) {
		throw new Error('Build failed - no manifest generated');
	}
	const { manifest } = buildResult;

	const duration = Date.now() - startTime;

	sendTelemetryEvent('hmr:rebuild-complete', {
		durationMs: duration,
		fileCount: filesToRebuild?.length ?? 0,
		framework: affectedFrameworks[0] ?? 'unknown'
	});

	await populateAssetStore(
		state.assetStore,
		manifest,
		state.resolvedPaths.buildDir
	);

	void cleanStaleAssets(
		state.assetStore,
		manifest,
		state.resolvedPaths.buildDir
	);

	broadcastToClients(state, {
		data: {
			affectedFrameworks,
			manifest
		},
		message: 'Rebuild completed successfully',
		type: 'rebuild-complete'
	});

	// `build()` already rebuilt the Tailwind output if a candidate changed;
	// trigger a CSS reload so the browser picks up the new utilities.
	if (
		config.tailwind &&
		filesToRebuild &&
		filesToRebuild.some(isTailwindCandidate)
	) {
		broadcastToClients(state, {
			data: { framework: 'tailwind', manifest },
			message: 'Tailwind utilities recompiled',
			type: 'style-update'
		});
	}

	const hasFilesToRebuild = filesToRebuild && filesToRebuild.length > 0;
	const didReloadForIslandChange = hasFilesToRebuild
		? await handleIslandSourceReload(
				state,
				config,
				filesToRebuild,
				manifest
			)
		: false;

	if (didReloadForIslandChange) {
		onRebuildComplete({ hmrState: state, manifest });

		return manifest;
	}

	if (hasFilesToRebuild) {
		await handleFullBuildHMR(
			state,
			config,
			affectedFrameworks,
			filesToRebuild,
			manifest,
			duration
		);
	}

	broadcastFrameworkUpdates(
		state,
		affectedFrameworks,
		filesToRebuild,
		manifest,
		startTime
	);

	if (affectedFrameworks.includes('angular')) {
		markSsrCacheDirty('angular');
	}
	if (affectedFrameworks.includes('react')) {
		markSsrCacheDirty('react');
	}
	if (affectedFrameworks.includes('svelte')) {
		markSsrCacheDirty('svelte');
	}
	if (affectedFrameworks.includes('vue')) {
		markSsrCacheDirty('vue');
	}

	onRebuildComplete({ hmrState: state, manifest });

	return manifest;
};

const drainPendingQueue = (
	state: HMRState,
	config: BuildConfig,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	if (state.fileChangeQueue.size === 0) {
		return;
	}

	const pending = Array.from(state.fileChangeQueue.keys());
	const queuedFiles: string[] = [];
	state.fileChangeQueue.forEach((filePaths) => {
		queuedFiles.push(...filePaths);
	});
	state.fileChangeQueue.clear();
	pending.forEach((file) => state.rebuildQueue.add(file));
	if (state.rebuildTimeout) clearTimeout(state.rebuildTimeout);
	state.rebuildTimeout = setTimeout(() => {
		void triggerRebuild(
			state,
			config,
			onRebuildComplete,
			queuedFiles.length > 0 ? queuedFiles : undefined
		);
	}, REBUILD_BATCH_DELAY_MS);
};

export const triggerRebuild = async (
	state: HMRState,
	config: BuildConfig,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void,
	filesToRebuild?: string[]
) => {
	if (state.isRebuilding) {
		return null;
	}

	state.isRebuilding = true;
	const affectedFrameworks = Array.from(state.rebuildQueue);
	state.rebuildQueue.clear();

	const startTime = Date.now();

	broadcastToClients(state, {
		data: { affectedFrameworks },
		message: 'Rebuild started...',
		type: 'rebuild-start'
	});

	try {
		return await performFullRebuild(
			state,
			config,
			affectedFrameworks,
			filesToRebuild,
			startTime,
			onRebuildComplete
		);
	} catch (error) {
		sendTelemetryEvent('hmr:rebuild-error', {
			durationMs: Date.now() - startTime,
			fileCount: filesToRebuild?.length ?? 0,
			framework: affectedFrameworks[0] ?? 'unknown',
			frameworks: affectedFrameworks,
			message: error instanceof Error ? error.message : String(error)
		});
		const errorData = extractBuildErrorDetails(
			error,
			affectedFrameworks,
			state.resolvedPaths
		);
		broadcastToClients(state, {
			data: {
				affectedFrameworks,
				error: error instanceof Error ? error.message : String(error),
				...errorData
			},
			message: 'Rebuild failed',
			type: 'rebuild-error'
		});

		return null;
	} finally {
		state.isRebuilding = false;
		drainPendingQueue(state, config, onRebuildComplete);
	}
};
