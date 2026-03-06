import { existsSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { build } from '../core/build';
import type { BuildConfig } from '../../types/build';
import { logger } from '../utils/logger';
import type { HMRState } from './clientManager';
import { incrementSourceFileVersions } from './clientManager';
import { getAffectedFiles } from './dependencyGraph';
import { computeFileHash, hasFileChanged } from './fileHashTracker';
import {
	createModuleUpdates,
	groupModuleUpdatesByFramework
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

/** Parse file:line:column or similar from error message (Svelte, Vue, Angular, etc.) */
const parseErrorLocationFromMessage = (msg: string) => {
	// file:line:column or file:line
	const pathLineCol = msg.match(/^([^\s:]+):(\d+)(?::(\d+))?/);
	if (pathLineCol) {
		const [, file, lineStr, colStr] = pathLineCol;
		return {
			file,
			line: lineStr ? parseInt(lineStr, 10) : undefined,
			column: colStr ? parseInt(colStr, 10) : undefined
		};
	}
	// "at path (line: col:)" or "at path:line:col"
	const atMatch = msg.match(
		/(?:at|in)\s+([^(:\s]+)(?:\s*\([^)]*line\s*(\d+)[^)]*col(?:umn)?\s*(\d+)[^)]*\)|:(\d+):(\d+)?)/i
	);
	if (atMatch) {
		const [, file, line1, col1, line2, col2] = atMatch;
		return {
			file: file?.trim(),
			line: line1
				? parseInt(line1, 10)
				: line2
					? parseInt(line2, 10)
					: undefined,
			column: col1
				? parseInt(col1, 10)
				: col2
					? parseInt(col2, 10)
					: undefined
		};
	}
	// "path (line X, column Y)"
	const parenMatch = msg.match(
		/([^\s(]+)\s*\([^)]*line\s*(\d+)[^)]*col(?:umn)?\s*(\d+)/i
	);
	if (parenMatch) {
		const [, file, lineStr, colStr] = parenMatch;
		return {
			file: file ?? undefined,
			line: lineStr ? parseInt(lineStr, 10) : undefined,
			column: colStr ? parseInt(colStr, 10) : undefined
		};
	}
	return {};
};

/** Extract file, line, column, lineText, and framework from build error for the overlay */
const extractBuildErrorDetails = (
	error: unknown,
	affectedFrameworks: string[],
	resolvedPaths?: ResolvedBuildPaths
) => {
	// AggregateError (Bun 1.2+ throws this) - errors array may contain BuildMessage-like objects
	let logs = (error as { logs?: BuildLog[] })?.logs;
	if (
		!logs &&
		error instanceof AggregateError &&
		(error as AggregateError).errors?.length
	) {
		logs = (error as AggregateError).errors as BuildLog[];
	}
	if (logs && Array.isArray(logs) && logs.length > 0) {
		const errLog = logs.find((l) => l.level === 'error') ?? logs[0];
		const pos = errLog?.position;
		// Position can be a class instance - ensure we read properties
		const file =
			pos && 'file' in pos ? (pos as { file?: string }).file : undefined;
		const line =
			pos && 'line' in pos ? (pos as { line?: number }).line : undefined;
		const column =
			pos && 'column' in pos
				? (pos as { column?: number }).column
				: undefined;
		const lineText =
			pos && 'lineText' in pos
				? (pos as { lineText?: string }).lineText
				: undefined;
		const framework =
			file && resolvedPaths
				? detectFramework(file, resolvedPaths)
				: (affectedFrameworks[0] ?? 'unknown');
		return {
			file,
			line,
			column,
			lineText,
			framework:
				framework !== 'ignored' ? framework : affectedFrameworks[0]
		};
	}
	const msg = error instanceof Error ? error.message : String(error);
	const parsed = parseErrorLocationFromMessage(msg);
	let fw = affectedFrameworks[0];
	if (parsed.file && resolvedPaths) {
		const detected = detectFramework(parsed.file, resolvedPaths);
		fw = detected !== 'ignored' ? detected : affectedFrameworks[0];
	}
	return { ...parsed, framework: fw };
};

/* Queue a file change for processing
   This handles the "queue changes" problem with debouncing */
export const queueFileChange = (
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

	// Compute current hash
	const currentHash = computeFileHash(filePath);

	// Check if file actually changed
	if (!hasFileChanged(filePath, currentHash, state.fileHashes)) {
		return;
	}

	// Get or create queue for this framework
	if (!state.fileChangeQueue.has(framework)) {
		state.fileChangeQueue.set(framework, []);
	}

	// Deduplicate: don't add the same file to the queue multiple times
	const queue = state.fileChangeQueue.get(framework)!;
	if (!queue.includes(filePath)) {
		queue.push(filePath);
	}

	// If we're already rebuilding, just queue it and wait
	if (state.isRebuilding) {
		return;
	}

	// Clear any existing rebuild trigger
	if (state.rebuildTimeout) {
		clearTimeout(state.rebuildTimeout);
	}

	// EVENT-DRIVEN APPROACH: Wait for a short window to collect all changes
	const DEBOUNCE_MS = config.options?.hmr?.debounceMs ?? 20;
	state.rebuildTimeout = setTimeout(() => {
		// Re-check hashes at the last moment to catch rapid edit/undo
		const filesToProcess: Map<string, string[]> = new Map(); // framework -> filePaths

		// Deduplicate files across the entire queue first
		const uniqueFilesByFramework = new Map<string, Set<string>>();
		for (const [fwKey, filePaths] of state.fileChangeQueue) {
			uniqueFilesByFramework.set(fwKey, new Set(filePaths));
		}

		for (const [fwKey, filePathSet] of uniqueFilesByFramework) {
			const validFiles: string[] = [];
			const processedFiles = new Set<string>(); // Track files we've already added

			for (const filePathInSet of filePathSet) {
				// Skip files that no longer exist (deleted)
				if (!existsSync(filePathInSet)) {
					// Remove from hash tracking
					state.fileHashes.delete(filePathInSet);
					// Still need to rebuild files that depended on this deleted file
					try {
						const affectedFiles = getAffectedFiles(
							state.dependencyGraph,
							filePathInSet
						);
						const deletedPathResolved = resolve(filePathInSet);
						for (const affectedFile of affectedFiles) {
							if (
								affectedFile !== deletedPathResolved &&
								!processedFiles.has(affectedFile) &&
								existsSync(affectedFile)
							) {
								validFiles.push(affectedFile);
								processedFiles.add(affectedFile);
							}
						}
					} catch { }
					continue;
				}

				// Compute hash at the LAST moment to catch rapid edit/undo
				const fileHash = computeFileHash(filePathInSet);
				const storedHash = state.fileHashes.get(filePathInSet);

				// Check if file actually changed since last rebuild
				// This is the critical check that prevents double rebuilds on edit/undo
				if (storedHash === undefined || storedHash !== fileHash) {
					// Normalize filePath to absolute path for consistent comparison
					// getAffectedFiles returns absolute paths, so we need to normalize here too
					const normalizedFilePath = resolve(filePathInSet);

					// Add the changed file itself (using normalized path)
					if (!processedFiles.has(normalizedFilePath)) {
						validFiles.push(normalizedFilePath);
						processedFiles.add(normalizedFilePath);
					}

					// Update hash NOW - this prevents the same file from being processed twice
					// if it was queued multiple times (edit then undo)
					state.fileHashes.set(normalizedFilePath, fileHash);

					// Increment source file version to force Bun to treat it as a new module
					// This bypasses Bun's module cache by appending version to import path
					incrementSourceFileVersions(state, [normalizedFilePath]);

					// CRITICAL: Also increment versions of files that import this file
					// When App.tsx changes, ReactExample.tsx needs a new version too
					// This forces ReactExample.tsx to re-import App.tsx fresh (bypassing cache)
					try {
						const dependents =
							state.dependencyGraph.dependents.get(
								normalizedFilePath
							);
						if (dependents && dependents.size > 0) {
							const dependentFiles = Array.from(
								dependents
							).filter((f) => existsSync(f));
							if (dependentFiles.length > 0) {
								incrementSourceFileVersions(
									state,
									dependentFiles
								);
							}
						}
					} catch { }

					// Get all files that depend on this changed file
					try {
						const affectedFiles = getAffectedFiles(
							state.dependencyGraph,
							normalizedFilePath
						);

						// Add affected files to the rebuild queue
						for (const affectedFile of affectedFiles) {
							if (
								!processedFiles.has(affectedFile) &&
								affectedFile !== normalizedFilePath &&
								existsSync(affectedFile)
							) {
								validFiles.push(affectedFile);
								processedFiles.add(affectedFile);
							}
						}
					} catch {
						if (!processedFiles.has(normalizedFilePath)) {
							validFiles.push(normalizedFilePath);
							processedFiles.add(normalizedFilePath);
						}
					}
				}
			}

			if (validFiles.length > 0) {
				// Re-detect framework from actual file paths (more reliable than using fwKey from queue)
				// This ensures HTMX files are correctly identified even if they were queued with wrong framework
				// Use the first valid file to determine the framework (all files in this set should have the same framework)
				const firstFile = validFiles[0];
				if (firstFile) {
					const detectedFramework = detectFramework(
						firstFile,
						state.resolvedPaths
					);
					filesToProcess.set(detectedFramework, validFiles);
				}
			}
		}

		state.fileChangeQueue.clear();

		if (filesToProcess.size === 0) {
			return;
		}

		const affectedFrameworks = Array.from(filesToProcess.keys());

		// Add affected frameworks to the rebuild queue
		for (const frameworkKey of affectedFrameworks) {
			state.rebuildQueue.add(frameworkKey);
		}

		// Collect all files to rebuild
		const filesToRebuild: string[] = [];
		for (const [, filePaths] of filesToProcess) {
			filesToRebuild.push(...filePaths);
		}

		// Trigger rebuild - the callback will be called with the manifest
		void triggerRebuild(state, config, onRebuildComplete, filesToRebuild);
	}, DEBOUNCE_MS);
};

/* Trigger a rebuild of the project
   This handles the "rebuild when needed" problem */
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

	// Notify clients that rebuild is starting
	broadcastToClients(state, {
		data: { affectedFrameworks },
		message: 'Rebuild started...',
		type: 'rebuild-start'
	});

	try {
		// Angular-only fast path: skip the full 4-pass Bun bundling.
		// Only JIT-compiles Angular files + bundles the client index
		// (single Bun.build pass) + SSR re-render. Skipping server,
		// React, and CSS bundling reduces Angular HMR significantly.
		const isAngularOnlyChange =
			affectedFrameworks.length === 1 &&
			affectedFrameworks[0] === 'angular' &&
			config.angularDirectory &&
			Object.keys(state.manifest).length > 0 &&
			filesToRebuild &&
			filesToRebuild.length > 0 &&
			!filesToRebuild.some((f) => f.endsWith('.css'));

		if (isAngularOnlyChange) {
			const angularDir = config.angularDirectory!;

			// Resolve affected files to page entry points
			const angularFiles = filesToRebuild!.filter(
				(file) =>
					detectFramework(file, state.resolvedPaths) === 'angular'
			);

			// Find page .ts files from the changed files
			const angularPagesPath = resolve(angularDir, 'pages');
			let pageEntries = angularFiles.filter(
				(f) =>
					f.endsWith('.ts') && resolve(f).startsWith(angularPagesPath)
			);

			// If no page files changed directly, resolve component files
			// to their parent pages via the dependency graph
			if (pageEntries.length === 0 && state.dependencyGraph) {
				const resolvedPages = new Set<string>();
				for (const componentFile of angularFiles) {
					let lookupFile = componentFile;
					if (componentFile.endsWith('.html')) {
						const tsCounterpart = componentFile.replace(
							/\.html$/,
							'.ts'
						);
						if (existsSync(tsCounterpart))
							lookupFile = tsCounterpart;
					}
					const affected = getAffectedFiles(
						state.dependencyGraph,
						lookupFile
					);
					for (const file of affected) {
						if (
							file.endsWith('.ts') &&
							resolve(file).startsWith(angularPagesPath)
						) {
							resolvedPages.add(file);
						}
					}
				}
				pageEntries = Array.from(resolvedPages);
			}

			if (pageEntries.length > 0) {
				// JIT compile Angular pages
				const { compileAngular } = await import(
					'../build/compileAngular'
				);
				const { clientPaths, serverPaths } = await compileAngular(
					pageEntries,
					angularDir,
					true
				);

				// Update Angular server paths in cached manifest
				for (const serverPath of serverPaths) {
					const fileBase = basename(serverPath, '.js');
					state.manifest[toPascal(fileBase)] = resolve(serverPath);
				}

				// Bundle Angular client indexes so the browser gets
				// updated component code.
				if (clientPaths.length > 0) {
					const { build: bunBuild } = await import('bun');
					const { generateManifest } = await import(
						'../build/generateManifest'
					);
					const { getAngularVendorPaths } = await import(
						'../core/devVendorPaths'
					);
					const { commonAncestor } = await import(
						'../utils/commonAncestor'
					);
					const buildDir = state.resolvedPaths.buildDir;

					// Compute the same clientRoot as build.ts to ensure
					// output paths match the initial build structure.
					const clientRoots = [
						state.resolvedPaths.reactDir,
						state.resolvedPaths.svelteDir,
						state.resolvedPaths.htmlDir,
						state.resolvedPaths.vueDir,
						state.resolvedPaths.angularDir
					].filter((dir): dir is string => Boolean(dir));
					const clientRoot =
						clientRoots.length === 1
							? (clientRoots[0] ?? process.cwd())
							: commonAncestor(clientRoots, process.cwd());

					// Externalize Angular packages (same as initial
					// build) so Bun only bundles user code (~50ms
					// instead of ~500ms bundling the full framework).
					const angVendorPaths = getAngularVendorPaths();

					const clientResult = await bunBuild({
						entrypoints: clientPaths,
						...(angVendorPaths
							? {
								external: Object.keys(angVendorPaths)
							}
							: {}),
						format: 'esm',
						naming: '[dir]/[name].[hash].[ext]',
						outdir: buildDir,
						root: clientRoot,
						target: 'browser',
						throw: false
					});
					if (clientResult.success) {
						// Rewrite bare Angular specifiers to vendor URLs
						if (angVendorPaths) {
							const { rewriteImports } = await import(
								'../build/rewriteImports'
							);
							await rewriteImports(
								clientResult.outputs.map(
									(artifact) => artifact.path
								),
								angVendorPaths
							);
						}

						const clientManifest = generateManifest(
							clientResult.outputs,
							buildDir
						);
						Object.assign(state.manifest, clientManifest);
						await populateAssetStore(
							state.assetStore,
							clientManifest,
							buildDir
						);
					}
				}
			}

			const manifest = state.manifest;

			// Run Angular HMR handler — same logic as the full path
			const angularHmrFiles = angularFiles.filter(
				(f) => f.endsWith('.ts') || f.endsWith('.html')
			);
			const angularPageFiles = angularHmrFiles.filter((f) =>
				f.replace(/\\/g, '/').includes('/pages/')
			);

			let pagesToUpdate =
				angularPageFiles.length > 0 ? angularPageFiles : pageEntries;

			// Skip SSR re-render for Angular HMR — the client re-bootstraps
			// the app by importing the updated index module directly.
			// SSR was taking ~450ms and the result was never used by the client.
			for (const angularPagePath of pagesToUpdate) {
				const fileName = basename(angularPagePath);
				const baseName = fileName.replace(/\.[tj]s$/, '');
				const pascalName = toPascal(baseName);
				const cssKey = `${pascalName}CSS`;
				const cssUrl = manifest[cssKey] || null;

				const duration = Date.now() - startTime;
				logger.hmrUpdate(angularPagePath, 'angular', duration);
				broadcastToClients(state, {
					data: {
						framework: 'angular',
						cssUrl,
						cssBaseName: baseName,
						updateType: 'logic' as const,
						manifest,
						sourceFile: angularPagePath
					},
					type: 'angular-update'
				});
			}

			onRebuildComplete({ manifest, hmrState: state });

			return manifest;
		}

		// React-only fast path: skip server, non-react client, and CSS
		// build passes. Only regenerate the changed index file + single
		// Bun.build for React client entries. Saves ~300-500ms.
		const isReactOnlyChange =
			affectedFrameworks.length === 1 &&
			affectedFrameworks[0] === 'react' &&
			config.reactDirectory &&
			Object.keys(state.manifest).length > 0 &&
			filesToRebuild &&
			filesToRebuild.length > 0 &&
			!filesToRebuild.some((f) => f.endsWith('.css'));

		if (isReactOnlyChange) {
			const reactDir = config.reactDirectory!;
			const reactPagesPath = resolve(reactDir, 'pages');
			const reactIndexesPath = resolve(reactDir, 'indexes');
			const buildDir = state.resolvedPaths.buildDir;

			// Regenerate index files — cleanup() removes them after the
			// initial build, so they may not exist. This is fast (~5ms)
			// since it only generates small template files.
			const { generateReactIndexFiles } = await import(
				'../build/generateReactIndexes'
			);
			await generateReactIndexFiles(
				reactPagesPath,
				reactIndexesPath,
				true
			);

			// Resolve changed files to their index entry points
			const reactEntries: string[] = [];
			const pagesPathResolved = resolve(reactPagesPath);
			for (const file of filesToRebuild) {
				const normalized = resolve(file);
				if (normalized.startsWith(pagesPathResolved)) {
					const pageName = basename(normalized, '.tsx');
					const indexPath = resolve(
						reactIndexesPath,
						`${pageName}.tsx`
					);
					if (existsSync(indexPath)) {
						reactEntries.push(indexPath);
					}
				} else {
					// Non-page file (component/util) — find which pages depend on it
					const affected = getAffectedFiles(
						state.dependencyGraph,
						normalized
					);
					for (const dep of affected) {
						if (dep.startsWith(pagesPathResolved)) {
							const pageName = basename(dep, '.tsx');
							const indexPath = resolve(
								reactIndexesPath,
								`${pageName}.tsx`
							);
							if (
								existsSync(indexPath) &&
								!reactEntries.includes(indexPath)
							) {
								reactEntries.push(indexPath);
							}
						}
					}
				}
			}

			if (reactEntries.length > 0) {
				const { build: bunBuild } = await import('bun');
				const { generateManifest } = await import(
					'../build/generateManifest'
				);
				const { getDevVendorPaths } = await import(
					'../core/devVendorPaths'
				);
				const { rewriteReactImports } = await import(
					'../build/rewriteReactImports'
				);
				const { commonAncestor } = await import(
					'../utils/commonAncestor'
				);

				// Add _refresh entry for shared React chunk
				const refreshEntry = resolve(reactIndexesPath, '_refresh.tsx');
				if (!reactEntries.includes(refreshEntry)) {
					reactEntries.push(refreshEntry);
				}

				// Compute clientRoot same as build.ts
				const clientRoots = [
					state.resolvedPaths.reactDir,
					state.resolvedPaths.svelteDir,
					state.resolvedPaths.htmlDir,
					state.resolvedPaths.vueDir,
					state.resolvedPaths.angularDir
				].filter((dir): dir is string => Boolean(dir));
				const clientRoot =
					clientRoots.length === 1
						? (clientRoots[0] ?? process.cwd())
						: commonAncestor(clientRoots, process.cwd());

				const vendorPaths = getDevVendorPaths();

				const { rmSync } = await import('node:fs');
				rmSync(resolve(buildDir, 'react', 'indexes'), {
					force: true,
					recursive: true
				});

				const clientResult = await bunBuild({
					entrypoints: reactEntries,
					format: 'esm',
					naming: '[dir]/[name].[hash].[ext]',
					outdir: buildDir,
					root: clientRoot,
					splitting: true,
					target: 'browser',
					throw: false,
					reactFastRefresh: true,
					...(vendorPaths
						? { external: Object.keys(vendorPaths) }
						: {})
				});

				if (clientResult.success) {
					if (vendorPaths) {
						await rewriteReactImports(
							clientResult.outputs.map((a) => a.path),
							vendorPaths
						);
					}

					const clientManifest = generateManifest(
						clientResult.outputs,
						buildDir
					);
					Object.assign(state.manifest, clientManifest);
					await populateAssetStore(
						state.assetStore,
						clientManifest,
						buildDir
					);
				}
			}

			const manifest = state.manifest;
			const duration = Date.now() - startTime;

			// Send React HMR update
			const reactFiles = filesToRebuild.filter(
				(file) => detectFramework(file, state.resolvedPaths) === 'react'
			);
			const reactPageFiles = reactFiles.filter((f) =>
				f.replace(/\\/g, '/').includes('/pages/')
			);
			const sourceFiles =
				reactPageFiles.length > 0 ? reactPageFiles : reactFiles;

			logger.hmrUpdate(
				sourceFiles[0] ?? reactFiles[0] ?? '',
				'react',
				duration
			);
			broadcastToClients(state, {
				data: {
					framework: 'react',
					manifest,
					sourceFiles,
					primarySource: sourceFiles[0],
					hasComponentChanges: true,
					hasCSSChanges: false
				},
				type: 'react-update'
			});

			onRebuildComplete({ manifest, hmrState: state });

			return manifest;
		}

		// Svelte-only fast path: skip React, Angular, HTML builds.
		// Only compile changed .svelte files + single Bun.build for
		// server + client entries.
		const isSvelteOnlyChange =
			affectedFrameworks.length === 1 &&
			affectedFrameworks[0] === 'svelte' &&
			config.svelteDirectory &&
			Object.keys(state.manifest).length > 0 &&
			filesToRebuild &&
			filesToRebuild.length > 0 &&
			!filesToRebuild.some((f) => f.endsWith('.css'));

		if (isSvelteOnlyChange) {
			const svelteDir = config.svelteDirectory!;
			const buildDir = state.resolvedPaths.buildDir;

			// Filter to svelte files that changed
			const svelteFiles = filesToRebuild.filter(
				(f) =>
					f.endsWith('.svelte') &&
					resolve(f).startsWith(resolve(svelteDir, 'pages'))
			);

			if (svelteFiles.length > 0) {
				const { compileSvelte } = await import(
					'../build/compileSvelte'
				);
				const { build: bunBuild } = await import('bun');
				const { generateManifest } = await import(
					'../build/generateManifest'
				);
				const { commonAncestor } = await import(
					'../utils/commonAncestor'
				);

				const {
					svelteServerPaths,
					svelteIndexPaths,
					svelteClientPaths
				} = await compileSvelte(
					svelteFiles,
					svelteDir,
					new Map(),
					true
				);

				const clientRoots = [
					state.resolvedPaths.reactDir,
					state.resolvedPaths.svelteDir,
					state.resolvedPaths.htmlDir,
					state.resolvedPaths.vueDir,
					state.resolvedPaths.angularDir
				].filter((dir): dir is string => Boolean(dir));
				const clientRoot =
					clientRoots.length === 1
						? (clientRoots[0] ?? process.cwd())
						: commonAncestor(clientRoots, process.cwd());

				// Server + client builds in parallel
				const serverEntries = [...svelteServerPaths];
				const clientEntries = [
					...svelteIndexPaths,
					...svelteClientPaths
				];

				const serverFrameworkDirs = [svelteDir].filter(Boolean);
				const serverRoot = resolve(serverFrameworkDirs[0]!, 'server');
				const serverOutDir = resolve(
					buildDir,
					basename(serverFrameworkDirs[0]!)
				);

				const [serverResult, clientResult] = await Promise.all([
					serverEntries.length > 0
						? bunBuild({
							entrypoints: serverEntries,
							external: ['svelte', 'svelte/*'],
							format: 'esm',
							naming: '[dir]/[name].[hash].[ext]',
							outdir: serverOutDir,
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
							root: clientRoot,
							target: 'browser',
							throw: false
						})
						: undefined
				]);

				if (serverResult?.success) {
					const serverManifest = generateManifest(
						serverResult.outputs,
						buildDir
					);
					// Server pages use absolute paths for SSR import()
					for (const artifact of serverResult.outputs) {
						const fileWithHash = basename(artifact.path);
						const [baseName] = fileWithHash.split(
							`.${artifact.hash}.`
						);
						if (baseName) {
							state.manifest[toPascal(baseName)] = artifact.path;
						}
					}
				}

				if (clientResult?.success) {
					const clientManifest = generateManifest(
						clientResult.outputs,
						buildDir
					);
					Object.assign(state.manifest, clientManifest);
					await populateAssetStore(
						state.assetStore,
						clientManifest,
						buildDir
					);
				}
			}

			const manifest = state.manifest;
			const duration = Date.now() - startTime;

			// Send Svelte HMR update for each page
			for (const sveltePagePath of svelteFiles.length > 0
				? svelteFiles
				: filesToRebuild) {
				const fileName = basename(sveltePagePath);
				const baseName = fileName.replace(/\.svelte$/, '');
				const pascalName = toPascal(baseName);
				const cssKey = `${pascalName}CSS`;
				const cssUrl = manifest[cssKey] || null;

				logger.hmrUpdate(sveltePagePath, 'svelte', duration);
				broadcastToClients(state, {
					data: {
						framework: 'svelte',
						html: null,
						cssUrl,
						cssBaseName: baseName,
						updateType: 'full',
						manifest,
						sourceFile: sveltePagePath
					},
					type: 'svelte-update'
				});
			}

			onRebuildComplete({ manifest, hmrState: state });

			return manifest;
		}

		// Vue-only fast path: skip React, Angular, HTML builds.
		// Only compile changed .vue files + single Bun.build for
		// server + client entries.
		const isVueOnlyChange =
			affectedFrameworks.length === 1 &&
			affectedFrameworks[0] === 'vue' &&
			config.vueDirectory &&
			Object.keys(state.manifest).length > 0 &&
			filesToRebuild &&
			filesToRebuild.length > 0 &&
			!filesToRebuild.some((f) => f.endsWith('.css'));

		if (isVueOnlyChange) {
			const vueDir = config.vueDirectory!;
			const buildDir = state.resolvedPaths.buildDir;

			// Filter to vue files that changed
			const vueFiles = filesToRebuild.filter(
				(f) =>
					f.endsWith('.vue') &&
					resolve(f).startsWith(resolve(vueDir, 'pages'))
			);

			if (vueFiles.length > 0) {
				const { compileVue } = await import('../build/compileVue');
				const { build: bunBuild } = await import('bun');
				const { generateManifest } = await import(
					'../build/generateManifest'
				);
				const { commonAncestor } = await import(
					'../utils/commonAncestor'
				);

				const {
					vueServerPaths,
					vueIndexPaths,
					vueClientPaths,
					vueCssPaths
				} = await compileVue(vueFiles, vueDir, true);

				const clientRoots = [
					state.resolvedPaths.reactDir,
					state.resolvedPaths.svelteDir,
					state.resolvedPaths.htmlDir,
					state.resolvedPaths.vueDir,
					state.resolvedPaths.angularDir
				].filter((dir): dir is string => Boolean(dir));
				const clientRoot =
					clientRoots.length === 1
						? (clientRoots[0] ?? process.cwd())
						: commonAncestor(clientRoots, process.cwd());

				const serverEntries = [...vueServerPaths];
				const clientEntries = [...vueIndexPaths, ...vueClientPaths];

				const serverFrameworkDirs = [vueDir].filter(Boolean);
				const serverRoot = resolve(serverFrameworkDirs[0]!, 'server');
				const serverOutDir = resolve(
					buildDir,
					basename(serverFrameworkDirs[0]!)
				);

				const vueFeatureFlags: Record<string, string> = {
					__VUE_OPTIONS_API__: 'true',
					__VUE_PROD_DEVTOOLS__: 'true',
					__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true'
				};

				const [serverResult, clientResult] = await Promise.all([
					serverEntries.length > 0
						? bunBuild({
							entrypoints: serverEntries,
							external: ['vue', 'vue/*'],
							format: 'esm',
							naming: '[dir]/[name].[hash].[ext]',
							outdir: serverOutDir,
							root: serverRoot,
							target: 'bun',
							throw: false
						})
						: undefined,
					clientEntries.length > 0
						? bunBuild({
							define: vueFeatureFlags,
							entrypoints: clientEntries,
							format: 'esm',
							naming: '[dir]/[name].[hash].[ext]',
							outdir: buildDir,
							root: clientRoot,
							target: 'browser',
							throw: false
						})
						: undefined
				]);

				if (serverResult?.success) {
					for (const artifact of serverResult.outputs) {
						const fileWithHash = basename(artifact.path);
						const [baseName] = fileWithHash.split(
							`.${artifact.hash}.`
						);
						if (baseName) {
							state.manifest[toPascal(baseName)] = artifact.path;
						}
					}
				}

				if (clientResult?.success) {
					const clientManifest = generateManifest(
						clientResult.outputs,
						buildDir
					);
					Object.assign(state.manifest, clientManifest);
					await populateAssetStore(
						state.assetStore,
						clientManifest,
						buildDir
					);
				}
			}

			const manifest = state.manifest;
			const duration = Date.now() - startTime;

			// Send Vue HMR update for each page
			const vuePageFiles =
				vueFiles.length > 0 ? vueFiles : filesToRebuild;
			for (const vuePagePath of vuePageFiles) {
				const fileName = basename(vuePagePath);
				const baseName = fileName.replace(/\.vue$/, '');
				const pascalName = toPascal(baseName);
				const cssKey = `${pascalName}CSS`;
				const cssUrl = manifest[cssKey] || null;

				const vueRoot = config.vueDirectory;
				const hmrId = vueRoot
					? relative(vueRoot, vuePagePath)
						.replace(/\\/g, '/')
						.replace(/\.vue$/, '')
					: baseName;

				logger.hmrUpdate(vuePagePath, 'vue', duration);
				broadcastToClients(state, {
					data: {
						framework: 'vue',
						html: null,
						hmrId,
						changeType: 'full',
						componentPath: manifest[`${pascalName}Client`] || null,
						cssUrl,
						updateType: 'full',
						manifest,
						sourceFile: vuePagePath
					},
					type: 'vue-update'
				});
			}

			onRebuildComplete({ manifest, hmrState: state });

			return manifest;
		}

		const manifest = await build({
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
		});

		if (!manifest) {
			throw new Error('Build failed - no manifest generated');
		}

		const duration = Date.now() - startTime;

		sendTelemetryEvent('hmr:rebuild-complete', {
			framework: affectedFrameworks[0] ?? 'unknown',
			durationMs: duration,
			fileCount: filesToRebuild?.length ?? 0
		});

		// Populate the in-memory asset store BEFORE broadcasting to clients.
		// Clients that receive HMR messages (e.g. react-update) will immediately
		// try to fetch new bundles via HTTP. If the asset store hasn't been
		// populated yet, the server can't serve them — causing a race condition
		// where HMR is detected but changes don't appear in the browser.
		await populateAssetStore(
			state.assetStore,
			manifest,
			state.resolvedPaths.buildDir
		);

		// Fire-and-forget: stale asset cleanup is non-critical and should
		// not block HMR broadcasts. It only removes old hashed files from disk.
		void cleanStaleAssets(
			state.assetStore,
			manifest,
			state.resolvedPaths.buildDir
		);

		// Notify clients of successful rebuild
		broadcastToClients(state, {
			data: {
				affectedFrameworks,
				manifest
			},
			message: 'Rebuild completed successfully',
			type: 'rebuild-complete'
		});

		// Create smart module updates from changed files
		if (filesToRebuild && filesToRebuild.length > 0) {
			const allModuleUpdates: Array<{
				sourceFile: string;
				framework: string;
				moduleKeys: string[];
				modulePaths: Record<string, string>;
				componentType?: 'client' | 'server';
			}> = [];

			// Group changed files by framework and create module updates
			for (const framework of affectedFrameworks) {
				const frameworkFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === framework
				);

				if (frameworkFiles.length > 0) {
					const moduleUpdates = createModuleUpdates(
						frameworkFiles,
						framework,
						manifest,
						state.resolvedPaths
					);

					if (moduleUpdates.length > 0) {
						allModuleUpdates.push(...moduleUpdates);
					}
				}
			}

			// Simple React HMR: Re-render and send HTML patch
			if (
				affectedFrameworks.includes('react') &&
				filesToRebuild &&
				state.resolvedPaths.reactDir
			) {
				const reactFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'react'
				);

				if (reactFiles.length > 0) {
					// Prefer changed page files; fall back to any React file
					const reactPageFiles = reactFiles.filter((file) => {
						const normalized = file.replace(/\\/g, '/');
						return normalized.includes('/pages/');
					});
					const sourceFiles =
						reactPageFiles.length > 0 ? reactPageFiles : reactFiles;
					const primarySource = sourceFiles[0];

					try {
						// Check if only CSS files changed (no component files)
						const hasComponentChanges = reactFiles.some(
							(file) =>
								file.endsWith('.tsx') ||
								file.endsWith('.ts') ||
								file.endsWith('.jsx')
						);
						const hasCSSChanges = reactFiles.some((file) =>
							file.endsWith('.css')
						);

						// Log the HMR update
						logger.hmrUpdate(
							primarySource ?? reactFiles[0] ?? '',
							'react',
							duration
						);

						// Send react-update message without HTML - client will import and re-render
						broadcastToClients(state, {
							data: {
								framework: 'react',
								manifest,
								sourceFiles,
								primarySource,
								hasComponentChanges: hasComponentChanges,
								hasCSSChanges: hasCSSChanges
								// No html field - client handles the update
							},
							type: 'react-update'
						});
					} catch (err) {
						sendTelemetryEvent('hmr:error', {
							framework: 'react',
							message:
								err instanceof Error ? err.message : String(err)
						});
					}
				}
			}

			// SCRIPT-ONLY HMR: If only TypeScript/JavaScript scripts changed (not HTML pages),
			// send a lightweight script-update message. The client will use import.meta.hot to
			// hot-reload just the script, preserving DOM and state.
			if (
				affectedFrameworks.includes('html') &&
				filesToRebuild &&
				state.resolvedPaths.htmlDir
			) {
				const htmlFrameworkFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'html'
				);

				if (htmlFrameworkFiles.length > 0) {
					// Separate script files from HTML page files
					const scriptFiles = htmlFrameworkFiles.filter(
						(f) =>
							(f.endsWith('.ts') ||
								f.endsWith('.js') ||
								f.endsWith('.tsx') ||
								f.endsWith('.jsx')) &&
							f.replace(/\\/g, '/').includes('/scripts/')
					);
					const htmlPageFiles = htmlFrameworkFiles.filter((f) =>
						f.endsWith('.html')
					);

					// If ONLY scripts changed (no HTML pages), send script-update for each
					if (scriptFiles.length > 0 && htmlPageFiles.length === 0) {
						for (const scriptFile of scriptFiles) {
							// Get the built script path from manifest
							const scriptBaseName = basename(scriptFile).replace(
								/\.(ts|js|tsx|jsx)$/,
								''
							);
							const pascalName = toPascal(scriptBaseName);
							const manifestKey = pascalName;
							const scriptPath = manifest[manifestKey] || null;

							if (scriptPath) {
								logger.scriptUpdate(
									scriptFile,
									'html',
									duration
								);
								broadcastToClients(state, {
									data: {
										framework: 'html',
										scriptPath,
										sourceFile: scriptFile,
										manifest
									},
									type: 'script-update'
								});
							} else {
								logger.warn(
									`Script not found in manifest: ${manifestKey}`
								);
							}
						}
						// Skip full HTML update since we handled the scripts
					}
				}
			}

			// Simple HTML HMR: Read HTML file and send HTML patch
			// Trigger if HTML files changed OR if CSS files in HTML directory changed (CSS updates need to push new HTML with updated CSS links)
			if (
				affectedFrameworks.includes('html') &&
				filesToRebuild &&
				state.resolvedPaths.htmlDir
			) {
				const htmlFrameworkFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'html'
				);

				// Trigger update if any HTML framework files changed (HTML files OR CSS files in HTML directory)
				if (htmlFrameworkFiles.length > 0) {
					// Collect all affected HTML pages (from dependency graph + direct edits)
					const htmlPageFiles = htmlFrameworkFiles.filter((f) =>
						f.endsWith('.html')
					);
					// Only process if we have actual HTML files - skip if only scripts/CSS changed
					const pagesToUpdate = htmlPageFiles;

					// Use the BUILT file path (which has updated CSS paths from updateAssetPaths)
					// Build path: build/html/pages/HTMLExample.html (or build/pages/HTMLExample.html if single)
					const isSingle =
						!config.reactDirectory &&
						!config.svelteDirectory &&
						!config.vueDirectory &&
						!config.htmxDirectory;
					const outputHtmlPages = isSingle
						? resolve(state.resolvedPaths.buildDir, 'pages')
						: resolve(
							state.resolvedPaths.buildDir,
							basename(config.htmlDirectory ?? 'html'),
							'pages'
						);

					for (const pageFile of pagesToUpdate) {
						const htmlPageName = basename(pageFile);
						const builtHtmlPagePath = resolve(
							outputHtmlPages,
							htmlPageName
						);

						// Simple approach: Read HTML file, extract body, send HTML patch
						try {
							const { handleHTMLUpdate } = await import(
								'./simpleHTMLHMR'
							);
							const newHTML =
								await handleHTMLUpdate(builtHtmlPagePath);

							if (newHTML) {
								logger.hmrUpdate(pageFile, 'html', duration);
								// Send simple HTML update to clients (includes updated CSS links from updateAssetPaths)
								broadcastToClients(state, {
									data: {
										framework: 'html',
										html: newHTML,
										manifest,
										sourceFile: builtHtmlPagePath
									},
									type: 'html-update'
								});
							}
						} catch (err) {
							sendTelemetryEvent('hmr:error', {
								framework: 'html',
								message:
									err instanceof Error
										? err.message
										: String(err)
							});
						}
					}
				}
			}

			// Simple Vue HMR: Re-compile and re-render, send HTML patch
			// NOTE: Vue HMR happens AFTER the rebuild completes, so we have the updated manifest
			if (
				affectedFrameworks.includes('vue') &&
				filesToRebuild &&
				config.vueDirectory
			) {
				const vueFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'vue'
				);

				if (vueFiles.length > 0) {
					// Detect CSS-only changes (no .vue files changed, only .css files)
					const vueComponentFiles = vueFiles.filter((f) =>
						f.endsWith('.vue')
					);
					const vueCssFiles = vueFiles.filter((f) =>
						f.endsWith('.css')
					);
					const isCssOnlyChange =
						vueComponentFiles.length === 0 &&
						vueCssFiles.length > 0;

					// Find all Vue page components from changed files (supports multi-component)
					const vuePageFiles = vueFiles.filter((f) =>
						f.replace(/\\/g, '/').includes('/pages/')
					);
					// If no pages found, use all .vue files (component changes trigger page rebuilds via dependency graph)
					const pagesToUpdate =
						vuePageFiles.length > 0
							? vuePageFiles
							: vueComponentFiles;

					// For CSS-only changes (no .vue files changed), send CSS-only update
					if (isCssOnlyChange && vueCssFiles.length > 0) {
						// Get CSS file info
						const cssFile = vueCssFiles[0];
						if (cssFile) {
							const cssBaseName = basename(cssFile, '.css');
							const cssPascalName = toPascal(cssBaseName);
							const cssKey = `${cssPascalName}CSS`;
							const cssUrl = manifest[cssKey] || null;

							logger.cssUpdate(cssFile, 'vue', duration);
							// Broadcast CSS-only update
							broadcastToClients(state, {
								data: {
									framework: 'vue',
									updateType: 'css-only',
									cssUrl,
									cssBaseName,
									manifest,
									sourceFile: cssFile
								},
								type: 'vue-update'
							});
						}
					}

					// Process each affected Vue page
					for (const vuePagePath of pagesToUpdate) {
						try {
							const fileName = basename(vuePagePath);
							const baseName = fileName.replace(/\.vue$/, '');
							const pascalName = toPascal(baseName);

							// Calculate HMR ID (relative path without .vue extension, matches compileVue.ts)
							const vueRoot = config.vueDirectory;
							const hmrId = vueRoot
								? relative(vueRoot, vuePagePath)
									.replace(/\\/g, '/')
									.replace(/\.vue$/, '')
								: baseName;

							// Get CSS URL from manifest
							const cssKey = `${pascalName}CSS`;
							const cssUrl = manifest[cssKey] || null;

							// Get change type from vueHmrMetadata (populated during compile)
							// Enables native Vue HMR: rerender() for template-only, reload() for script
							// style-only changes get CSS hot-swap (state preserved!)
							const { vueHmrMetadata } = await import(
								'../build/compileVue'
							);
							const hmrMeta = vueHmrMetadata.get(
								resolve(vuePagePath)
							);
							const changeType = hmrMeta?.changeType ?? 'full';

							// Check for style-only change - send CSS-only update (preserves state!)
							if (changeType === 'style-only') {
								logger.cssUpdate(vuePagePath, 'vue', duration);
								broadcastToClients(state, {
									data: {
										framework: 'vue',
										updateType: 'css-only',
										changeType: 'style-only',
										cssUrl,
										cssBaseName: baseName,
										hmrId,
										manifest,
										sourceFile: vuePagePath
									},
									type: 'vue-update'
								});
								continue;
							}

							const componentPath =
								manifest[`${pascalName}Client`] || null;

							logger.hmrUpdate(vuePagePath, 'vue', duration);
							broadcastToClients(state, {
								data: {
									framework: 'vue',
									html: null,
									hmrId,
									changeType,
									componentPath,
									cssUrl,
									updateType: 'full',
									manifest,
									sourceFile: vuePagePath
								},
								type: 'vue-update'
							});
						} catch (err) {
							sendTelemetryEvent('hmr:error', {
								framework: 'vue',
								message:
									err instanceof Error
										? err.message
										: String(err)
							});
						}
					}
				}
			}

			// Simple Svelte HMR: Re-compile and re-render, send HTML patch
			// NOTE: Svelte HMR happens AFTER the rebuild completes, so we have the updated manifest
			if (
				affectedFrameworks.includes('svelte') &&
				filesToRebuild &&
				config.svelteDirectory
			) {
				const svelteFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'svelte'
				);

				if (svelteFiles.length > 0) {
					// Detect CSS-only changes (no .svelte files changed, only .css files)
					const svelteComponentFiles = svelteFiles.filter((f) =>
						f.endsWith('.svelte')
					);
					const svelteCssFiles = svelteFiles.filter((f) =>
						f.endsWith('.css')
					);
					const isCssOnlyChange =
						svelteComponentFiles.length === 0 &&
						svelteCssFiles.length > 0;

					// Find all Svelte page components from changed files (supports multi-component)
					const sveltePageFiles = svelteFiles.filter((f) =>
						f.replace(/\\/g, '/').includes('/pages/')
					);
					// If no pages found, use all .svelte files (component changes trigger page rebuilds via dependency graph)
					const pagesToUpdate =
						sveltePageFiles.length > 0
							? sveltePageFiles
							: svelteComponentFiles;

					// For CSS-only changes, send CSS-only update (preserves component state!)
					if (isCssOnlyChange && svelteCssFiles.length > 0) {
						// Get CSS file info
						const cssFile = svelteCssFiles[0];
						if (cssFile) {
							const cssBaseName = basename(cssFile, '.css');
							const cssPascalName = toPascal(cssBaseName);
							const cssKey = `${cssPascalName}CSS`;
							const cssUrl = manifest[cssKey] || null;

							logger.cssUpdate(cssFile, 'svelte', duration);
							// Broadcast CSS-only update
							broadcastToClients(state, {
								data: {
									framework: 'svelte',
									updateType: 'css-only',
									cssUrl,
									cssBaseName,
									manifest,
									sourceFile: cssFile
								},
								type: 'svelte-update'
							});
						}
					}

					// Process each affected Svelte page
					for (const sveltePagePath of pagesToUpdate) {
						try {
							const fileName = basename(sveltePagePath);
							const baseName = fileName.replace(/\.svelte$/, '');
							const pascalName = toPascal(baseName);

							// Get CSS URL from manifest
							const cssKey = `${pascalName}CSS`;
							const cssUrl = manifest[cssKey] || null;

							logger.hmrUpdate(
								sveltePagePath,
								'svelte',
								duration
							);
							broadcastToClients(state, {
								data: {
									framework: 'svelte',
									html: null,
									cssUrl,
									cssBaseName: baseName,
									updateType: 'full',
									manifest,
									sourceFile: sveltePagePath
								},
								type: 'svelte-update'
							});
						} catch (err) {
							sendTelemetryEvent('hmr:error', {
								framework: 'svelte',
								message:
									err instanceof Error
										? err.message
										: String(err)
							});
						}
					}
				}
			}

			// Angular HMR Optimization — Re-render and send HTML patch with update classification
			// NOTE: Angular HMR happens AFTER the rebuild completes, so we have the updated manifest
			if (
				affectedFrameworks.includes('angular') &&
				filesToRebuild &&
				config.angularDirectory
			) {
				const angularFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'angular'
				);

				if (angularFiles.length > 0) {
					// Classify update type: CSS-only changes get a
					// lightweight stylesheet swap that preserves state.
					const angularCssFiles = angularFiles.filter((f) =>
						f.endsWith('.css')
					);
					const isCssOnlyChange =
						angularFiles.every((f) => f.endsWith('.css')) &&
						angularCssFiles.length > 0;

					// Find Angular page files from changed files
					const angularPageFiles = angularFiles.filter((f) =>
						f.replace(/\\/g, '/').includes('/pages/')
					);

					// If no page files changed directly, resolve component files
					// to their parent pages via the dependency graph.
					let pagesToUpdate = angularPageFiles;
					if (pagesToUpdate.length === 0 && state.dependencyGraph) {
						const resolvedPages = new Set<string>();
						for (const componentFile of angularFiles) {
							// Angular .html templates aren't tracked in
							// the dependency graph (they're referenced via
							// templateUrl, not import). Resolve them to
							// the co-located .ts file first so the graph
							// lookup can find the parent page.
							let lookupFile = componentFile;
							if (componentFile.endsWith('.html')) {
								const tsCounterpart = componentFile.replace(
									/\.html$/,
									'.ts'
								);
								if (existsSync(tsCounterpart)) {
									lookupFile = tsCounterpart;
								}
							}

							const affected = getAffectedFiles(
								state.dependencyGraph,
								lookupFile
							);
							for (const file of affected) {
								if (
									file
										.replace(/\\/g, '/')
										.includes('/pages/') &&
									file.endsWith('.ts')
								) {
									resolvedPages.add(file);
								}
							}
						}
						pagesToUpdate = Array.from(resolvedPages);
					}

					// For CSS-only changes, send CSS-only update (preserves component state!)
					// Skip the full SSR re-render — stylesheet swap is sufficient.
					if (isCssOnlyChange && angularCssFiles.length > 0) {
						const cssFile = angularCssFiles[0];
						if (cssFile) {
							const cssBaseName = basename(cssFile, '.css');
							const cssPascalName = toPascal(cssBaseName);
							const cssKey = `${cssPascalName}CSS`;
							const cssUrl = manifest[cssKey] || null;

							logger.cssUpdate(cssFile, 'angular', duration);
							broadcastToClients(state, {
								data: {
									framework: 'angular',
									updateType: 'style',
									cssUrl,
									cssBaseName,
									manifest,
									sourceFile: cssFile
								},
								type: 'angular-update'
							});
						}
					} else {
						// Process each affected Angular page (non-CSS changes only)
						for (const angularPagePath of pagesToUpdate) {
							try {
								const fileName = basename(angularPagePath);
								const baseName = fileName.replace(
									/\.[tj]s$/,
									''
								);
								const pascalName = toPascal(baseName);

								// Get CSS URL from manifest
								const cssKey = `${pascalName}CSS`;
								const cssUrl = manifest[cssKey] || null;

								// Skip SSR re-render — the client re-bootstraps
								// Angular by importing the updated index module
								// directly, so SSR HTML is never used.
								logger.hmrUpdate(
									angularPagePath,
									'angular',
									duration
								);
								broadcastToClients(state, {
									data: {
										framework: 'angular',
										cssUrl,
										cssBaseName: baseName,
										updateType: 'logic' as const,
										manifest,
										sourceFile: angularPagePath
									},
									type: 'angular-update'
								});
							} catch (err) {
								sendTelemetryEvent('hmr:error', {
									framework: 'angular',
									message:
										err instanceof Error
											? err.message
											: String(err)
								});
							}
						}
					}
				}
			}

			// HTMX SCRIPT-ONLY HMR: Same as HTML - if only scripts changed, send script-update
			if (
				affectedFrameworks.includes('htmx') &&
				filesToRebuild &&
				state.resolvedPaths.htmxDir
			) {
				const htmxFrameworkFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'htmx'
				);

				if (htmxFrameworkFiles.length > 0) {
					const htmxScriptFiles = htmxFrameworkFiles.filter(
						(f) =>
							(f.endsWith('.ts') ||
								f.endsWith('.js') ||
								f.endsWith('.tsx') ||
								f.endsWith('.jsx')) &&
							f.replace(/\\/g, '/').includes('/scripts/')
					);
					const htmxHtmlFiles = htmxFrameworkFiles.filter((f) =>
						f.endsWith('.html')
					);

					if (
						htmxScriptFiles.length > 0 &&
						htmxHtmlFiles.length === 0
					) {
						for (const scriptFile of htmxScriptFiles) {
							const scriptBaseName = basename(scriptFile).replace(
								/\.(ts|js|tsx|jsx)$/,
								''
							);
							const pascalName = toPascal(scriptBaseName);
							const manifestKey = pascalName;
							const scriptPath = manifest[manifestKey] || null;

							if (scriptPath) {
								logger.scriptUpdate(
									scriptFile,
									'htmx',
									duration
								);
								broadcastToClients(state, {
									data: {
										framework: 'htmx',
										scriptPath,
										sourceFile: scriptFile,
										manifest
									},
									type: 'script-update'
								});
							}
						}
					}
				}
			}

			// Simple HTMX HMR: Read HTMX file and send HTML patch
			// Trigger if HTMX files changed OR if CSS files in HTMX directory changed (CSS updates need to push new HTML with updated CSS links)
			if (
				affectedFrameworks.includes('htmx') &&
				filesToRebuild &&
				state.resolvedPaths.htmxDir
			) {
				const htmxFrameworkFiles = filesToRebuild.filter(
					(file) =>
						detectFramework(file, state.resolvedPaths) === 'htmx'
				);

				// Trigger update if any HTMX framework files changed (HTML files OR CSS files in HTMX directory)
				if (htmxFrameworkFiles.length > 0) {
					// Only process if we have actual HTML page files - skip if only scripts/CSS changed
					const htmxPageFiles = htmxFrameworkFiles.filter((f) =>
						f.endsWith('.html')
					);

					// Use the BUILT file path (which has updated CSS paths from updateAssetPaths)
					// Build path: build/htmx/pages/*.html (or build/pages/*.html if single)
					const isSingle =
						!config.reactDirectory &&
						!config.svelteDirectory &&
						!config.vueDirectory &&
						!config.htmlDirectory;
					const outputHtmxPages = isSingle
						? resolve(state.resolvedPaths.buildDir, 'pages')
						: resolve(
							state.resolvedPaths.buildDir,
							basename(config.htmxDirectory ?? 'htmx'),
							'pages'
						);

					// Process each affected HTMX page
					for (const htmxPageFile of htmxPageFiles) {
						const htmxPageName = basename(htmxPageFile);
						const builtHtmxPagePath = resolve(
							outputHtmxPages,
							htmxPageName
						);

						try {
							const { handleHTMXUpdate } = await import(
								'./simpleHTMXHMR'
							);
							const newHTML =
								await handleHTMXUpdate(builtHtmxPagePath);

							if (newHTML) {
								logger.hmrUpdate(
									htmxPageFile,
									'htmx',
									duration
								);
								broadcastToClients(state, {
									data: {
										framework: 'htmx',
										html: newHTML,
										manifest,
										sourceFile: builtHtmxPagePath
									},
									type: 'htmx-update'
								});
							}
						} catch (err) {
							sendTelemetryEvent('hmr:error', {
								framework: 'htmx',
								message:
									err instanceof Error
										? err.message
										: String(err)
							});
						}
					}
				}
			}

			// Increment module versions for all updated modules
			const updatedModulePaths: string[] = [];
			for (const update of allModuleUpdates) {
				// Add source file path
				updatedModulePaths.push(update.sourceFile);
				// Add all manifest module paths
				for (const modulePath of Object.values(update.modulePaths)) {
					updatedModulePaths.push(modulePath);
				}
			}

			if (updatedModulePaths.length > 0) {
				incrementModuleVersions(
					state.moduleVersions,
					updatedModulePaths
				);
			}

			// Send module-level updates grouped by framework
			if (allModuleUpdates.length > 0) {
				const updatesByFramework =
					groupModuleUpdatesByFramework(allModuleUpdates);
				const serverVersions = serializeModuleVersions(
					state.moduleVersions
				);

				for (const [framework, updates] of updatesByFramework) {
					// Get versions for updated modules
					const moduleVersions: Record<string, number> = {};
					for (const update of updates) {
						const sourceVersion = state.moduleVersions.get(
							update.sourceFile
						);
						if (sourceVersion !== undefined) {
							moduleVersions[update.sourceFile] = sourceVersion;
						}
						for (const [, path] of Object.entries(
							update.modulePaths
						)) {
							const pathVersion = state.moduleVersions.get(path);
							if (pathVersion !== undefined) {
								moduleVersions[path] = pathVersion;
							}
						}
					}

					broadcastToClients(state, {
						data: {
							framework,
							manifest,
							modules: updates.map((update) => ({
								componentType: update.componentType,
								moduleKeys: update.moduleKeys,
								modulePaths: update.modulePaths,
								sourceFile: update.sourceFile, // Include component type for React Fast Refresh
								version: state.moduleVersions.get(
									update.sourceFile
								)
								// Include version // Include version
							})), // Include full manifest for reference
							moduleVersions: moduleVersions, // Include versions for updated modules
							serverVersions: serverVersions
							// Include all server versions for sync check // Include all server versions for sync check
						},
						message: `${framework} modules updated`,
						type: 'module-update'
					});
				}
			}
		}

		// Send individual framework updates (for backward compatibility)
		for (const framework of affectedFrameworks) {
			const type =
				framework === 'styles' || framework === 'assets'
					? 'style-update'
					: 'framework-update';

			if (type === 'style-update' && filesToRebuild) {
				const duration = Date.now() - startTime;
				for (const file of filesToRebuild) {
					// Only log the files that actually belong to this global framework category
					if (detectFramework(file, state.resolvedPaths) === framework) {
						logger.cssUpdate(file, framework, duration);
					}
				}
			}
			broadcastToClients(state, {
				data: {
					framework,
					manifest
				},
				message: `${framework} framework updated`,
				type: type as any
			});
		}

		// Call the callback with the new build result
		onRebuildComplete({ manifest, hmrState: state });

		return manifest;
	} catch (error) {
		sendTelemetryEvent('hmr:rebuild-error', {
			framework: affectedFrameworks[0] ?? 'unknown',
			frameworks: affectedFrameworks,
			message: error instanceof Error ? error.message : String(error),
			fileCount: filesToRebuild?.length ?? 0,
			durationMs: Date.now() - startTime
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
		// Flush changes accumulated during rebuild
		if (state.fileChangeQueue.size > 0) {
			const pending = Array.from(state.fileChangeQueue.keys());
			const queuedFiles: string[] = [];
			for (const [, filePaths] of state.fileChangeQueue) {
				queuedFiles.push(...filePaths);
			}
			state.fileChangeQueue.clear();
			for (const f of pending) state.rebuildQueue.add(f);
			if (state.rebuildTimeout) clearTimeout(state.rebuildTimeout);
			state.rebuildTimeout = setTimeout(() => {
				void triggerRebuild(
					state,
					config,
					onRebuildComplete,
					queuedFiles.length > 0 ? queuedFiles : undefined
				);
			}, 50);
		}
	}
};
