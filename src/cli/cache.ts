import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Glob } from 'bun';
import type { ToolAdapter, ToolCacheData } from '../../types/tool';
import { BASE_36_RADIX } from '../constants';

export const CACHE_DIR = '.absolutejs';
export const MAX_FILES_PER_BATCH = 200;
const isIgnored = (file: string, ignorePatterns: string[]) =>
	ignorePatterns.some((pat) => new Glob(pat).match(file));

const collectFiles = async (pattern: string, ignorePatterns: string[]) => {
	const files: string[] = [];
	const glob = new Glob(pattern);
	for await (const file of glob.scan({
		cwd: '.',
		dot: false
	})) {
		if (!isIgnored(file, ignorePatterns)) files.push(file);
	}

	return files;
};

export const getChangedFiles = async (adapter: ToolAdapter) => {
	const results = await Promise.all(
		adapter.fileGlobs.map((pattern) =>
			collectFiles(pattern, adapter.ignorePatterns)
		)
	);
	const allFiles = results
		.flat()
		.filter((file): file is string => Boolean(file));

	const [fileHashes, configHash, existing] = await Promise.all([
		hashFiles(allFiles),
		hashConfigs(adapter.configFiles),
		loadCache(adapter.name)
	]);

	const newCache: ToolCacheData = { configHash, files: fileHashes };

	if (!existing || existing.configHash !== configHash) {
		return { cache: newCache, changed: allFiles };
	}

	const changed = allFiles.filter(
		(file) => fileHashes[file] !== existing.files[file]
	);

	return { cache: newCache, changed };
};
export const hashConfigs = async (configFiles: string[]) => {
	const hashes = await Promise.all(
		configFiles.map(async (file) => {
			try {
				return await hashFile(file);
			} catch {
				return 'missing';
			}
		})
	);

	return hashes.join(':');
};
export const hashFile = async (path: string) => {
	const buffer = await Bun.file(path).arrayBuffer();

	return Bun.hash(buffer).toString(BASE_36_RADIX);
};
export const hashFiles = async (paths: string[]) => {
	const entries = await Promise.all(
		paths.map(async (path) => [path, await hashFile(path)] as const)
	);

	return Object.fromEntries(entries);
};
export const loadCache = async (tool: string) => {
	try {
		const path = join(CACHE_DIR, `${tool}.cache.json`);

		const data = await Bun.file(path).json();

		const result: ToolCacheData = data;

		return result;
	} catch {
		return null;
	}
};
const runBatch = async (
	adapter: ToolAdapter,
	batch: string[],
	args: string[],
	failedFiles: Set<string>
) => {
	const command = adapter.buildCommand(batch, args);
	const proc = Bun.spawn(command, {
		stderr: 'inherit',
		stdout: 'inherit'
	});
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		batch.forEach((file) => failedFiles.add(file));
	}
};

export const runTool = async (adapter: ToolAdapter, args: string[]) => {
	const { changed, cache } = await getChangedFiles(adapter);
	const totalFiles = Object.keys(cache.files).length;

	if (changed.length === 0) {
		console.log('\x1b[32m✓\x1b[0m All files passed (cached)');

		return;
	}

	console.log(`Checking ${changed.length}/${totalFiles} file(s)...`);

	const batches: string[][] = [];
	for (let idx = 0; idx < changed.length; idx += MAX_FILES_PER_BATCH) {
		batches.push(changed.slice(idx, idx + MAX_FILES_PER_BATCH));
	}

	const failedFiles = new Set<string>();

	await batches.reduce(
		(chain, batch) =>
			chain.then(() => runBatch(adapter, batch, args, failedFiles)),
		Promise.resolve()
	);

	for (const file of failedFiles) {
		delete cache.files[file];
	}

	const successFiles = changed.filter((file) => !failedFiles.has(file));
	const updatedHashes = await hashFiles(successFiles);
	Object.assign(cache.files, updatedHashes);

	await saveCache(adapter.name, cache);

	if (failedFiles.size > 0) {
		process.exit(1);
	}

	console.log('\x1b[32m✓\x1b[0m Passed');
};
export const saveCache = async (tool: string, data: ToolCacheData) => {
	await mkdir(CACHE_DIR, { recursive: true });
	const path = join(CACHE_DIR, `${tool}.cache.json`);
	await Bun.write(path, JSON.stringify(data, null, '\t'));
};
