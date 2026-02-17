import { resolve } from 'node:path';
import { readdir, unlink } from 'node:fs/promises';

const mimeTypes: Record<string, string> = {
	'.css': 'text/css',
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
};

/** Determine Content-Type from a file path extension */
export const getMimeType = (filePath: string): string => {
	const ext = filePath.slice(filePath.lastIndexOf('.'));

	return mimeTypes[ext] ?? 'application/octet-stream';
};

/** Matches Bun's hashed output naming: name.XXXXXXXX.ext */
const HASHED_FILE_RE = /\.[a-z0-9]{8}\.(js|css|mjs)$/;

/** Strip the 8-char hash from a hashed path to get its logical identity.
 *  e.g. /react/indexes/ReactExample.abc12345.js → /react/indexes/ReactExample.js */
const stripHash = (webPath: string): string =>
	webPath.replace(/\.[a-z0-9]{8}(\.(js|css|mjs))$/, '$1');

/** Upsert build outputs into the in-memory asset store.
 *  Evicts previous entries for the same logical asset (same base name,
 *  different hash) so stale paths don't accumulate. */
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

	// Evict old store entries whose logical identity is being replaced
	for (const existingPath of store.keys()) {
		const identity = stripHash(existingPath);
		const replacement = newIdentities.get(identity);
		if (replacement && replacement !== existingPath) {
			store.delete(existingPath);
		}
	}

	for (const webPath of newIdentities.values()) {
		loadPromises.push(
			Bun.file(resolve(buildDir, webPath.slice(1)))
				.bytes()
				.then((bytes) => {
					store.set(webPath, bytes);
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
			const subTasks: Promise<void>[] = [];
			for (const entry of entries) {
				if (entry.isDirectory()) {
					subTasks.push(
						scanDir(
							resolve(dir, entry.name),
							`${prefix}${entry.name}/`
						)
					);
				} else if (entry.name.startsWith('chunk-')) {
					const webPath = `/${prefix}${entry.name}`;
					if (!store.has(webPath)) {
						subTasks.push(
							Bun.file(resolve(dir, entry.name))
								.bytes()
								.then((bytes) => {
									store.set(webPath, bytes);
								})
								.catch(() => {})
						);
					}
				}
			}
			await Promise.all(subTasks);
		};
		await scanDir(buildDir, '');
	} catch {
		/* buildDir may not exist yet */
	}

	await Promise.all(loadPromises);
};

/** Remove hashed build files whose logical identity has a newer version.
 *  Checks both client assets (from the store) and SSR server files (from
 *  the manifest's absolute-path entries). Non-blocking async version. */
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
	for (const val of Object.values(manifest)) {
		if (!HASHED_FILE_RE.test(val)) continue;
		// Absolute disk paths start with the buildDir; web-relative
		// paths (e.g. /svelte/compiled/...) are short and already
		// covered by the store above.
		if (val.startsWith(absBuildDir)) {
			liveByIdentity.set(stripHash(val), val);
		}
	}

	try {
		const walkAndClean = async (dir: string) => {
			const entries = await readdir(dir, { withFileTypes: true });
			const tasks: Promise<void>[] = [];
			for (const entry of entries) {
				const fullPath = resolve(dir, entry.name);
				if (entry.isDirectory()) {
					tasks.push(walkAndClean(fullPath));
				} else if (HASHED_FILE_RE.test(entry.name)) {
					const identity = stripHash(fullPath);
					const livePath = liveByIdentity.get(identity);
					// Only delete if we have a DIFFERENT version of the
					// same logical file. Untracked files are left alone.
					if (livePath && livePath !== fullPath) {
						tasks.push(unlink(fullPath).catch(() => {}));
					}
				}
			}
			await Promise.all(tasks);
		};
		await walkAndClean(buildDir);
	} catch {
		/* buildDir may not exist */
	}
};

/** Look up an asset by its web path. Returns bytes or undefined. */
export const lookupAsset = (
	store: Map<string, Uint8Array>,
	path: string
): Uint8Array | undefined => store.get(path);
