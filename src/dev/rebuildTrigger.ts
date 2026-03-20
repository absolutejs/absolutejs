import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { build } from '../core/build';
import type { BuildConfig } from '../../types/build';
import {
	logCssUpdate,
	logHmrUpdate,
	logScriptUpdate,
	logWarn
} from '../utils/logger';
import { incrementSourceFileVersions, type HMRState } from './clientManager';
import { getAffectedFiles } from './dependencyGraph';
import { DEFAULT_DEBOUNCE_MS, REBUILD_BATCH_DELAY_MS } from '../constants';
import { computeFileHash, hasFileChanged } from './fileHashTracker';
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
import { invalidateAngularSsrCache } from '../angular/pageHandler';

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

	const currentHash = computeFileHash(filePath);

	if (!hasFileChanged(filePath, currentHash, state.fileHashes)) {
		return;
	}

	if (!state.fileChangeQueue.has(framework)) {
		state.fileChangeQueue.set(framework, []);
	}

	const queue = state.fileChangeQueue.get(framework);
	if (queue && !queue.includes(filePath)) {
		queue.push(filePath);
	}

	if (state.isRebuilding) {
		return;
	}

	if (state.rebuildTimeout) {
		clearTimeout(state.rebuildTimeout);
	}

	const DEBOUNCE_MS = config.options?.hmr?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	state.rebuildTimeout = setTimeout(() => {
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
	const clientRoots = [
		resolvedPaths.reactDir,
		resolvedPaths.svelteDir,
		resolvedPaths.htmlDir,
		resolvedPaths.vueDir,
		resolvedPaths.angularDir
	].filter((dir): dir is string => Boolean(dir));

	const { commonAncestor } = await import('../utils/commonAncestor');

	return clientRoots.length === 1
		? (clientRoots[0] ?? process.cwd())
		: commonAncestor(clientRoots, process.cwd());
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
	buildDir: string
) => {
	const { build: bunBuild } = await import('bun');
	const { generateManifest } = await import('../build/generateManifest');
	const { getAngularVendorPaths } = await import('../core/devVendorPaths');
	const clientRoot = await computeClientRoot(state.resolvedPaths);

	let angVendorPaths = getAngularVendorPaths();
	if (!angVendorPaths) {
		const { computeAngularVendorPaths } = await import(
			'../build/buildAngularVendor'
		);
		const { setAngularVendorPaths } = await import(
			'../core/devVendorPaths'
		);
		angVendorPaths = computeAngularVendorPaths();
		setAngularVendorPaths(angVendorPaths);
	}

	const clientResult = await bunBuild({
		entrypoints: clientPaths,
		...(angVendorPaths ? { external: Object.keys(angVendorPaths) } : {}),
		format: 'esm',
		naming: '[dir]/[name].[hash].[ext]',
		outdir: buildDir,
		root: clientRoot,
		target: 'browser',
		throw: false
	});

	if (!clientResult.success) {
		return;
	}

	if (angVendorPaths) {
		const { rewriteImports } = await import('../build/rewriteImports');
		await rewriteImports(
			clientResult.outputs.map((artifact) => artifact.path),
			angVendorPaths
		);
	}

	const clientManifest = generateManifest(clientResult.outputs, buildDir);
	Object.assign(state.manifest, clientManifest);
	await populateAssetStore(state.assetStore, clientManifest, buildDir);
};

const broadcastAngularPageUpdates = (
	state: HMRState,
	pagesToUpdate: string[],
	manifest: Record<string, string>,
	startTime: number
) => {
	pagesToUpdate.forEach((angularPagePath) => {
		const fileName = basename(angularPagePath);
		const baseName = fileName.replace(/\.[tj]s$/, '');
		const pascalName = toPascal(baseName);
		const cssKey = `${pascalName}CSS`;
		const cssUrl = manifest[cssKey] || null;

		const duration = Date.now() - startTime;
		logHmrUpdate(angularPagePath, 'angular', duration);
		broadcastToClients(state, {
			data: {
				cssBaseName: baseName,
				cssUrl,
				framework: 'angular',
				manifest,
				sourceFile: angularPagePath,
				updateType: 'logic' as const
			},
			type: 'angular-update'
		});
	});
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
		true
	);

	serverPaths.forEach((serverPath) => {
		const fileBase = basename(serverPath, '.js');
		state.manifest[toPascal(fileBase)] = resolve(serverPath);
	});

	if (clientPaths.length > 0) {
		await bundleAngularClient(
			state,
			clientPaths,
			state.resolvedPaths.buildDir
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

	const angularPagesPath = resolve(angularDir, 'pages');
	const pageEntries = resolveAngularPageEntries(
		state,
		angularFiles,
		angularPagesPath
	);

	if (pageEntries.length > 0) {
		await compileAndBundleAngular(state, pageEntries, angularDir);
		invalidateAngularSsrCache();
	}

	if (pageEntries.length > 0 && !config.options?.preserveIntermediateFiles) {
		await rm(resolve(angularDir, 'compiled'), {
			force: true,
			recursive: true
		});
	}

	const { manifest } = state;
	const angularHmrFiles = angularFiles.filter(
		(file) => file.endsWith('.ts') || file.endsWith('.html')
	);
	const angularPageFiles = angularHmrFiles.filter((file) =>
		file.replace(/\\/g, '/').includes('/pages/')
	);
	const pagesToUpdate =
		angularPageFiles.length > 0 ? angularPageFiles : pageEntries;

	broadcastAngularPageUpdates(state, pagesToUpdate, manifest, startTime);

	onRebuildComplete({ hmrState: state, manifest });

	return manifest;
};

const resolveReactEntryForPageFile = (
	normalized: string,
	pagesPathResolved: string,
	reactIndexesPath: string
) => {
	const pageName = basename(normalized, '.tsx');
	const indexPath = resolve(reactIndexesPath, `${pageName}.tsx`);
	if (!existsSync(indexPath)) {
		return undefined;
	}

	return indexPath;
};

const resolveReactEntriesFromDeps = (
	state: HMRState,
	normalized: string,
	pagesPathResolved: string,
	reactIndexesPath: string,
	reactEntries: string[]
) => {
	const affected = getAffectedFiles(state.dependencyGraph, normalized);
	affected.forEach((dep) => {
		if (!dep.startsWith(pagesPathResolved)) {
			return;
		}
		const pageName = basename(dep, '.tsx');
		const indexPath = resolve(reactIndexesPath, `${pageName}.tsx`);
		if (existsSync(indexPath) && !reactEntries.includes(indexPath)) {
			reactEntries.push(indexPath);
		}
	});
};

const resolveReactEntryForFile = (
	state: HMRState,
	file: string,
	pagesPathResolved: string,
	reactIndexesPath: string,
	reactEntries: string[]
) => {
	const normalized = resolve(file);
	if (!normalized.startsWith(pagesPathResolved)) {
		resolveReactEntriesFromDeps(
			state,
			normalized,
			pagesPathResolved,
			reactIndexesPath,
			reactEntries
		);

		return;
	}

	const entry = resolveReactEntryForPageFile(
		normalized,
		pagesPathResolved,
		reactIndexesPath
	);
	if (entry) {
		reactEntries.push(entry);
	}
};

const collectReactEntries = (
	state: HMRState,
	filesToRebuild: string[],
	reactPagesPath: string,
	reactIndexesPath: string
) => {
	const reactEntries: string[] = [];
	const pagesPathResolved = resolve(reactPagesPath);

	filesToRebuild.forEach((file) => {
		resolveReactEntryForFile(
			state,
			file,
			pagesPathResolved,
			reactIndexesPath,
			reactEntries
		);
	});

	return reactEntries;
};

const bundleReactClient = async (
	state: HMRState,
	reactEntries: string[],
	reactIndexesPath: string,
	buildDir: string
) => {
	const { build: bunBuild } = await import('bun');
	const { generateManifest } = await import('../build/generateManifest');
	const { getDevVendorPaths } = await import('../core/devVendorPaths');
	const { rewriteReactImports } = await import(
		'../build/rewriteReactImports'
	);
	const clientRoot = await computeClientRoot(state.resolvedPaths);

	const refreshEntry = resolve(reactIndexesPath, '_refresh.tsx');
	if (!reactEntries.includes(refreshEntry)) {
		reactEntries.push(refreshEntry);
	}

	let vendorPaths = getDevVendorPaths();
	if (!vendorPaths) {
		const { computeVendorPaths } = await import(
			'../build/buildReactVendor'
		);
		const { setDevVendorPaths } = await import('../core/devVendorPaths');
		vendorPaths = computeVendorPaths();
		setDevVendorPaths(vendorPaths);
	}

	const { rmSync } = await import('node:fs');
	rmSync(resolve(buildDir, 'react', 'indexes'), {
		force: true,
		recursive: true
	});

	const clientResult = await bunBuild({
		entrypoints: reactEntries,
		format: 'esm',
		jsx: { development: true },
		naming: '[dir]/[name].[hash].[ext]',
		outdir: buildDir,
		reactFastRefresh: true,
		root: clientRoot,
		splitting: true,
		target: 'browser',
		throw: false,
		...(vendorPaths ? { external: Object.keys(vendorPaths) } : {})
	});

	if (!clientResult.success) {
		return;
	}

	if (vendorPaths) {
		await rewriteReactImports(
			clientResult.outputs.map((art) => art.path),
			vendorPaths
		);
	}

	const clientManifest = generateManifest(clientResult.outputs, buildDir);
	Object.assign(state.manifest, clientManifest);
	await populateAssetStore(state.assetStore, clientManifest, buildDir);
};

const buildSingleReactPage = async (
	state: HMRState,
	pageFile: string,
	buildDir: string
) => {
	const { build: bunBuild } = await import('bun');
	const { generateManifest } = await import('../build/generateManifest');
	const { getDevVendorPaths } = await import('../core/devVendorPaths');
	const { rewriteReactImports } = await import(
		'../build/rewriteReactImports'
	);
	const { commonAncestor } = await import('../utils/commonAncestor');

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

	let vendorPaths = getDevVendorPaths();
	if (!vendorPaths) {
		const { computeVendorPaths } = await import(
			'../build/buildReactVendor'
		);
		const { setDevVendorPaths } = await import('../core/devVendorPaths');
		vendorPaths = computeVendorPaths();
		setDevVendorPaths(vendorPaths);
	}

	const result = await bunBuild({
		entrypoints: [pageFile],
		external: vendorPaths ? Object.keys(vendorPaths) : [],
		format: 'esm',
		jsx: { development: true },
		naming: '[dir]/[name].[hash].[ext]',
		outdir: buildDir,
		reactFastRefresh: true,
		root: clientRoot,
		splitting: false,
		target: 'browser',
		throw: false
	});

	if (!result.success) return undefined;

	const outputPaths = result.outputs.map((a) => a.path);

	if (vendorPaths) {
		await rewriteReactImports(outputPaths, vendorPaths);
	}

	const pageManifest = generateManifest(result.outputs, buildDir);
	Object.assign(state.manifest, pageManifest);
	await populateAssetStore(state.assetStore, pageManifest, buildDir);

	const [firstOutput] = result.outputs;
	if (!firstOutput) return undefined;

	return `/${relative(buildDir, firstOutput.path).replace(/\\/g, '/')}`;
};

const handleReactFastPath = async (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	startTime: number,
	onRebuildComplete: (result: {
		manifest: Record<string, string>;
		hmrState: HMRState;
	}) => void
) => {
	const reactDir = config.reactDirectory ?? '';
	const reactPagesPath = resolve(reactDir, 'pages');
	const reactIndexesPath = resolve(reactDir, 'indexes');
	const { buildDir } = state.resolvedPaths;

	// O(1) fast path: if only page files changed, build just the changed
	// page with splitting:false. Skips index generation, chunk computation,
	// and processing all other entries.
	const reactFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'react'
	);
	const pagesPathResolved = resolve(reactPagesPath);
	const allArePageFiles =
		reactFiles.length > 0 &&
		reactFiles.every(
			(file) =>
				(file.endsWith('.tsx') || file.endsWith('.jsx')) &&
				resolve(file).startsWith(pagesPathResolved)
		);

	if (allArePageFiles) {
		const [pageFile] = reactFiles;
		if (pageFile) {
			const pageModuleUrl = await buildSingleReactPage(
				state,
				pageFile,
				buildDir
			);

			if (pageModuleUrl) {
				const duration = Date.now() - startTime;
				logHmrUpdate(pageFile, 'react', duration);
				broadcastToClients(state, {
					data: {
						framework: 'react',
						hasComponentChanges: true,
						hasCSSChanges: false,
						manifest: state.manifest,
						pageModuleUrl,
						primarySource: pageFile,
						sourceFiles: reactFiles
					},
					type: 'react-update'
				});
				onRebuildComplete({
					hmrState: state,
					manifest: state.manifest
				});

				return state.manifest;
			}
		}
	}

	// Full rebuild path: component changes or fast path failed
	const { generateReactIndexFiles } = await import(
		'../build/generateReactIndexes'
	);
	await generateReactIndexFiles(reactPagesPath, reactIndexesPath, true);

	const reactEntries = collectReactEntries(
		state,
		filesToRebuild,
		reactPagesPath,
		reactIndexesPath
	);

	if (reactEntries.length > 0) {
		await bundleReactClient(
			state,
			reactEntries,
			reactIndexesPath,
			buildDir
		);
	}

	await rm(reactIndexesPath, { force: true, recursive: true });

	const { manifest } = state;
	const duration = Date.now() - startTime;

	const reactPageFiles = reactFiles.filter((file) =>
		file.replace(/\\/g, '/').includes('/pages/')
	);
	const sourceFiles = reactPageFiles.length > 0 ? reactPageFiles : reactFiles;

	logHmrUpdate(sourceFiles[0] ?? reactFiles[0] ?? '', 'react', duration);
	broadcastToClients(state, {
		data: {
			framework: 'react',
			hasComponentChanges: true,
			hasCSSChanges: false,
			manifest,
			primarySource: sourceFiles[0],
			sourceFiles
		},
		type: 'react-update'
	});

	onRebuildComplete({ hmrState: state, manifest });

	return manifest;
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
	const { buildDir } = state.resolvedPaths;

	const svelteFiles = filesToRebuild.filter(
		(file) =>
			file.endsWith('.svelte') &&
			resolve(file).startsWith(resolve(svelteDir, 'pages'))
	);

	if (svelteFiles.length > 0) {
		const { compileSvelte } = await import('../build/compileSvelte');
		const { build: bunBuild } = await import('bun');
		const clientRoot = await computeClientRoot(state.resolvedPaths);

		const { svelteServerPaths, svelteIndexPaths, svelteClientPaths } =
			await compileSvelte(svelteFiles, svelteDir, new Map(), true);

		const serverEntries = [...svelteServerPaths];
		const clientEntries = [...svelteIndexPaths, ...svelteClientPaths];

		const serverRoot = resolve(svelteDir, 'server');
		const serverOutDir = resolve(buildDir, basename(svelteDir));

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

		handleServerManifestUpdate(state, serverResult);
		await handleClientManifestUpdate(state, clientResult, buildDir);
	}

	await Promise.all([
		rm(resolve(svelteDir, 'client'), {
			force: true,
			recursive: true
		}),
		rm(resolve(svelteDir, 'indexes'), {
			force: true,
			recursive: true
		}),
		rm(resolve(svelteDir, 'server'), {
			force: true,
			recursive: true
		})
	]);

	const { manifest } = state;
	const duration = Date.now() - startTime;

	const sveltePageFiles =
		svelteFiles.length > 0 ? svelteFiles : filesToRebuild;
	sveltePageFiles.forEach((sveltePagePath) => {
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
	const vueDir = config.vueDirectory ?? '';
	const { buildDir } = state.resolvedPaths;

	const vueFiles = filesToRebuild.filter(
		(file) =>
			file.endsWith('.vue') &&
			resolve(file).startsWith(resolve(vueDir, 'pages'))
	);

	if (vueFiles.length > 0) {
		const { compileVue } = await import('../build/compileVue');
		const { build: bunBuild } = await import('bun');
		const clientRoot = await computeClientRoot(state.resolvedPaths);

		const { vueServerPaths, vueIndexPaths, vueClientPaths } =
			await compileVue(vueFiles, vueDir, true);

		const serverEntries = [...vueServerPaths];
		const clientEntries = [...vueIndexPaths, ...vueClientPaths];

		const serverRoot = resolve(vueDir, 'server');
		const serverOutDir = resolve(buildDir, basename(vueDir));

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

		handleServerManifestUpdate(state, serverResult);
		await handleClientManifestUpdate(state, clientResult, buildDir);
	}

	await Promise.all([
		rm(resolve(vueDir, 'client'), {
			force: true,
			recursive: true
		}),
		rm(resolve(vueDir, 'indexes'), {
			force: true,
			recursive: true
		}),
		rm(resolve(vueDir, 'server'), {
			force: true,
			recursive: true
		}),
		rm(resolve(vueDir, 'compiled'), {
			force: true,
			recursive: true
		})
	]);

	const { manifest } = state;
	const duration = Date.now() - startTime;

	const vuePageFiles = vueFiles.length > 0 ? vueFiles : filesToRebuild;
	vuePageFiles.forEach((vuePagePath) => {
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

		logHmrUpdate(vuePagePath, 'vue', duration);
		broadcastToClients(state, {
			data: {
				changeType: 'full',
				componentPath: manifest[`${pascalName}Client`] || null,
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
	});

	onRebuildComplete({ hmrState: state, manifest });

	return manifest;
};

const isFrameworkOnlyChange = (
	affectedFrameworks: string[],
	frameworkName: string,
	frameworkDir: string | undefined,
	state: HMRState,
	filesToRebuild?: string[]
) =>
	affectedFrameworks.length === 1 &&
	affectedFrameworks[0] === frameworkName &&
	frameworkDir &&
	Object.keys(state.manifest).length > 0 &&
	filesToRebuild &&
	filesToRebuild.length > 0 &&
	!filesToRebuild.some((file) => file.endsWith('.css'));

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
		const hasCSSChanges = reactFiles.some((file) => file.endsWith('.css'));

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

	const htmlFrameworkFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'html'
	);

	if (htmlFrameworkFiles.length === 0) {
		return;
	}

	const htmlPageFiles = htmlFrameworkFiles.filter((file) =>
		file.endsWith('.html')
	);
	const outputHtmlPages = computeOutputPagesDir(state, config, 'html');

	for (const pageFile of htmlPageFiles) {
		const htmlPageName = basename(pageFile);
		const builtHtmlPagePath = resolve(outputHtmlPages, htmlPageName);
		// eslint-disable-next-line no-await-in-loop
		await processHtmlPageUpdate(
			state,
			pageFile,
			builtHtmlPagePath,
			manifest,
			duration
		);
	}
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

	const cssBaseName = basename(cssFile, '.css');
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
	const vueCssFiles = vueFiles.filter((file) => file.endsWith('.css'));
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

	for (const vuePagePath of pagesToUpdate) {
		// eslint-disable-next-line no-await-in-loop
		await processVuePageUpdate(
			state,
			config,
			vuePagePath,
			manifest,
			duration
		);
	}
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

	const cssBaseName = basename(cssFile, '.css');
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
	const svelteCssFiles = svelteFiles.filter((file) => file.endsWith('.css'));
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

	const cssBaseName = basename(cssFile, '.css');
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

const broadcastAngularPageHmrUpdate = (
	state: HMRState,
	angularPagePath: string,
	manifest: Record<string, string>,
	duration: number
) => {
	try {
		const fileName = basename(angularPagePath);
		const baseName = fileName.replace(/\.[tj]s$/, '');
		const pascalName = toPascal(baseName);
		const cssKey = `${pascalName}CSS`;
		const cssUrl = manifest[cssKey] || null;

		logHmrUpdate(angularPagePath, 'angular', duration);
		broadcastToClients(state, {
			data: {
				cssBaseName: baseName,
				cssUrl,
				framework: 'angular',
				manifest,
				sourceFile: angularPagePath,
				updateType: 'logic' as const
			},
			type: 'angular-update'
		});
	} catch (err) {
		sendTelemetryEvent('hmr:error', {
			framework: 'angular',
			message: err instanceof Error ? err.message : String(err)
		});
	}
};

const handleAngularHMR = (
	state: HMRState,
	config: BuildConfig,
	filesToRebuild: string[],
	manifest: Record<string, string>,
	duration: number
) => {
	if (!config.angularDirectory) {
		return;
	}

	const angularFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'angular'
	);

	if (angularFiles.length === 0) {
		return;
	}

	const angularCssFiles = angularFiles.filter((file) =>
		file.endsWith('.css')
	);
	const isCssOnlyChange =
		angularFiles.every((file) => file.endsWith('.css')) &&
		angularCssFiles.length > 0;

	const angularPageFiles = angularFiles.filter((file) =>
		file.replace(/\\/g, '/').includes('/pages/')
	);

	let pagesToUpdate = angularPageFiles;
	if (pagesToUpdate.length === 0 && state.dependencyGraph) {
		pagesToUpdate = resolveAngularPagesFromDependencyGraph(
			state,
			angularFiles
		);
	}

	if (isCssOnlyChange && angularCssFiles.length > 0) {
		handleAngularCssOnlyUpdate(state, angularCssFiles, manifest, duration);

		return;
	}

	pagesToUpdate.forEach((angularPagePath) => {
		broadcastAngularPageHmrUpdate(
			state,
			angularPagePath,
			manifest,
			duration
		);
	});
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

	const htmxFrameworkFiles = filesToRebuild.filter(
		(file) => detectFramework(file, state.resolvedPaths) === 'htmx'
	);

	if (htmxFrameworkFiles.length === 0) {
		return;
	}

	const htmxPageFiles = htmxFrameworkFiles.filter((file) =>
		file.endsWith('.html')
	);
	const outputHtmxPages = computeOutputPagesDir(state, config, 'htmx');

	for (const htmxPageFile of htmxPageFiles) {
		const htmxPageName = basename(htmxPageFile);
		const builtHtmxPagePath = resolve(outputHtmxPages, htmxPageName);
		// eslint-disable-next-line no-await-in-loop
		await processHtmxPageUpdate(
			state,
			htmxPageFile,
			builtHtmxPagePath,
			manifest,
			duration
		);
	}
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
	if (
		isFrameworkOnlyChange(
			affectedFrameworks,
			'angular',
			config.angularDirectory,
			state,
			filesToRebuild
		)
	) {
		return handleAngularFastPath(
			state,
			config,
			filesToRebuild ?? [],
			startTime,
			onRebuildComplete
		);
	}

	if (
		isFrameworkOnlyChange(
			affectedFrameworks,
			'react',
			config.reactDirectory,
			state,
			filesToRebuild
		)
	) {
		return handleReactFastPath(
			state,
			config,
			filesToRebuild ?? [],
			startTime,
			onRebuildComplete
		);
	}

	if (
		isFrameworkOnlyChange(
			affectedFrameworks,
			'svelte',
			config.svelteDirectory,
			state,
			filesToRebuild
		)
	) {
		return handleSvelteFastPath(
			state,
			config,
			filesToRebuild ?? [],
			startTime,
			onRebuildComplete
		);
	}

	if (
		isFrameworkOnlyChange(
			affectedFrameworks,
			'vue',
			config.vueDirectory,
			state,
			filesToRebuild
		)
	) {
		return handleVueFastPath(
			state,
			config,
			filesToRebuild ?? [],
			startTime,
			onRebuildComplete
		);
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

	if (filesToRebuild && filesToRebuild.length > 0) {
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
		invalidateAngularSsrCache();
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
