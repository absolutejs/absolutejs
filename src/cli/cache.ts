import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Glob } from 'bun';
import type { ToolAdapter, ToolCacheData } from '../../types/tool';

export const CACHE_DIR = '.absolutejs';
export const MAX_FILES_PER_BATCH = 200;

export const hashFile = async (path: string) => {
	const buffer = await Bun.file(path).arrayBuffer();

	return Bun.hash(buffer).toString(36);
};

export const hashFiles = async (paths: string[]) => {
	const entries = await Promise.all(
		paths.map(async (path) => [path, await hashFile(path)] as const)
	);

	return Object.fromEntries(entries);
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

export const loadCache = async (tool: string) => {
	try {
		const path = join(CACHE_DIR, `${tool}.cache.json`);

		const data = await Bun.file(path).json();

		return data as ToolCacheData;
	} catch {
		return null;
	}
};

export const saveCache = async (tool: string, data: ToolCacheData) => {
	await mkdir(CACHE_DIR, { recursive: true });
	const path = join(CACHE_DIR, `${tool}.cache.json`);
	await Bun.write(path, JSON.stringify(data, null, '\t'));
};

export const getChangedFiles = async (adapter: ToolAdapter) => {
	const allFiles: string[] = [];

	for (const pattern of adapter.fileGlobs) {
		const glob = new Glob(pattern);
		for await (const file of glob.scan({
			cwd: '.',
			dot: false
		})) {
			const ignored = adapter.ignorePatterns.some((pat) => {
				const globPat = new Glob(pat);

				return globPat.match(file);
			});
			if (!ignored) {
				allFiles.push(file);
			}
		}
	}

	const [fileHashes, configHash, existing] = await Promise.all([
		hashFiles(allFiles),
		hashConfigs(adapter.configFiles),
		loadCache(adapter.name)
	]);

	const newCache: ToolCacheData = { configHash, files: fileHashes };

	if (!existing || existing.configHash !== configHash) {
		return { changed: allFiles, cache: newCache };
	}

	const changed = allFiles.filter(
		(file) => fileHashes[file] !== existing.files[file]
	);

	return { changed, cache: newCache };
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

	for (const batch of batches) {
		const command = adapter.buildCommand(batch, args);
		const proc = Bun.spawn(command, {
			stdout: 'inherit',
			stderr: 'inherit'
		});
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			for (const file of batch) {
				failedFiles.add(file);
			}
		}
	}

	for (const file of failedFiles) {
		delete cache.files[file];
	}

	await saveCache(adapter.name, cache);

	if (failedFiles.size > 0) {
		process.exit(1);
	}

	console.log('\x1b[32m✓\x1b[0m Passed');
};
