import { resolve } from 'node:path';
import { readdir, unlink } from 'node:fs/promises';

const mimeTypes: Record<string, string> = {
	'.css': 'text/css',
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.mjs': 'application/javascript',
	'.svg': 'image/svg+xml',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

/** Determine Content-Type from a file path extension */
export const getMimeType = (filePath: string) => {
	const ext = filePath.slice(filePath.lastIndexOf('.'));

	return mimeTypes[ext] ?? 'application/octet-stream';
};

/** Matches Bun's hashed output naming: name.XXXXXXXX.ext */
const HASHED_FILE_RE = /\.[a-z0-9]{8}\.(js|css|mjs)$/;

/** Strip the 8-char hash from a hashed path to get its logical identity.
 *  e.g. /react/indexes/ReactExample.abc12345.js → /react/indexes/ReactExample.js */
const stripHash = (webPath: string) =>
	webPath.replace(/\.[a-z0-9]{8}(\.(js|css|mjs))$/, '$1');

const processWalkEntry = (
	entry: import('node:fs').Dirent,
	dir: string,
	liveByIdentity: Map<string, string>,
	walkAndClean: (dir: string) => Promise<void>
) => {
	const fullPath = resolve(dir, entry.name);
	if (entry.isDirectory()) {
		return walkAndClean(fullPath);
	}
	if (!HASHED_FILE_RE.test(entry.name)) {
		return null;
	}
	const identity = stripHash(fullPath);
	const livePath = liveByIdentity.get(identity);
	// Delete if: (a) no live entry exists (page was deleted), or
	// (b) a different hash is live (stale version of an existing page).
	// Only keep the file when it IS the current live version.
	if (livePath !== fullPath) {
		return unlink(fullPath).catch(() => {
			/* noop */
		});
	}

	return null;
};

/** Upsert build outputs into the in-memory asset store.
 *  Evicts previous entries for the same logical asset (same base name,
 *  different hash) so stale paths don't accumulate. */
export const cleanStaleAssets = async (
	store: Map<string, Uint8Array>,
	manifest: Record<string, string>,
	buildDir: string
) => {
	// Build a map of logical identity → live disk path
	const liveByIdentity = new Map<string, string>();

	// Client assets from the in-memory store
	for (const webPath of store.keys()) {
		const diskPath = resolve(buildDir, webPath.slice(1));
		liveByIdentity.set(stripHash(diskPath), diskPath);
	}

	// SSR server files from the manifest (absolute disk paths like
	// /home/.../build/svelte/.../SvelteExample.hash.js)
	const absBuildDir = resolve(buildDir);
	Object.values(manifest).forEach((val) => {
		if (!HASHED_FILE_RE.test(val)) return;
		if (val.startsWith(absBuildDir)) {
			liveByIdentity.set(stripHash(val), val);
		}
	});

	try {
		const walkAndClean = async (dir: string) => {
			const entries = await readdir(dir, { withFileTypes: true });
			const tasks = entries
				.map((entry) =>
					processWalkEntry(entry, dir, liveByIdentity, walkAndClean)
				)
				.filter((task): task is Promise<void> => task !== null);
			await Promise.all(tasks);
		};
		await walkAndClean(buildDir);
	} catch {
		/* buildDir may not exist */
	}
};
export const lookupAsset = (store: Map<string, Uint8Array>, path: string) =>
	store.get(path);

const processScanEntry = (
	entry: import('node:fs').Dirent,
	dir: string,
	prefix: string,
	store: Map<string, Uint8Array>,
	scanDir: (dir: string, prefix: string) => Promise<void>
) => {
	if (entry.isDirectory()) {
		return scanDir(resolve(dir, entry.name), `${prefix}${entry.name}/`);
	}
	if (!entry.name.startsWith('chunk-')) {
		return null;
	}
	const webPath = `/${prefix}${entry.name}`;
	if (store.has(webPath)) {
		return null;
	}

	return Bun.file(resolve(dir, entry.name))
		.bytes()
		.then((bytes) => {
			store.set(webPath, bytes);

			return undefined;
		})
		.catch(() => {
			/* noop */
		});
};

export const populateAssetStore = async (
	store: Map<string, Uint8Array>,
	manifest: Record<string, string>,
	buildDir: string
) => {
	const loadPromises: Promise<void>[] = [];

	// Build a set of logical identities from the new manifest so we can
	// evict old entries with different hashes for the same asset.
	const newIdentities = new Map<string, string>();
	for (const webPath of Object.values(manifest)) {
		if (!webPath.startsWith('/')) continue;
		newIdentities.set(stripHash(webPath), webPath);
	}

	// Evict old store entries that are either:
	// (a) being replaced by a new hash (same identity, different path), or
	// (b) no longer in the manifest at all (page was deleted).
	// Chunk files (chunk-XXXX.js) are kept — they're not tracked in the manifest.
	const liveWebPaths = new Set(newIdentities.values());
	const staleKeys = [...store.keys()].filter((existingPath) => {
		if (existingPath.includes('/chunk-')) return false;
		const replacement = newIdentities.get(stripHash(existingPath));
		// Delete if replaced by a different hash OR if no identity exists at all
		if (replacement !== undefined) return replacement !== existingPath;

		return !liveWebPaths.has(existingPath);
	});
	staleKeys.forEach((key) => store.delete(key));

	for (const webPath of newIdentities.values()) {
		// Skip entries already in the store — their content hasn't changed
		// (same hash in the filename). Only load new or replaced assets.
		if (store.has(webPath)) continue;

		loadPromises.push(
			Bun.file(resolve(buildDir, webPath.slice(1)))
				.bytes()
				.then((bytes) => {
					store.set(webPath, bytes);

					return undefined;
				})
				.catch(() => {
					/* file may not exist yet (SSR-only entry) — ignore */
				})
		);
	}

	// Also pick up chunk files produced by Bun code-splitting that aren't
	// listed in the manifest (e.g. chunk-XXXX.js).
	try {
		const scanDir = async (dir: string, prefix: string) => {
			const entries = await readdir(dir, { withFileTypes: true });
			const subTasks = entries
				.map((entry) =>
					processScanEntry(entry, dir, prefix, store, scanDir)
				)
				.filter((task): task is Promise<void> => task !== null);
			await Promise.all(subTasks);
		};
		await scanDir(buildDir, '');
	} catch {
		/* buildDir may not exist yet */
	}

	await Promise.all(loadPromises);
};
