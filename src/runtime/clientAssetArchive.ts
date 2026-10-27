import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const PREFIX = '/_absolute/assets/';
const ID = /^[a-f0-9]{64}$/;
const MAX_GRAPHS = 3;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024 * 1024;

type GraphManifest = { createdAt: number; bytes: number; paths: string[] };
const safePath = (path: string) =>
	path.length > 0 &&
	!path.includes('\\') &&
	!path.includes('\0') &&
	path
		.split('/')
		.every((part) => part.length > 0 && part !== '.' && part !== '..');
const readManifest = async (
	path: string
): Promise<GraphManifest | undefined> => {
	try {
		const value: unknown = JSON.parse(
			await readFile(join(path, 'graph.json'), 'utf8')
		);
		if (!value || typeof value !== 'object') return;
		const createdAt: unknown = Reflect.get(value, 'createdAt');
		const bytes: unknown = Reflect.get(value, 'bytes');
		const paths: unknown = Reflect.get(value, 'paths');
		if (
			typeof createdAt !== 'number' ||
			!Number.isFinite(createdAt) ||
			typeof bytes !== 'number' ||
			!Number.isSafeInteger(bytes) ||
			bytes < 0 ||
			!Array.isArray(paths) ||
			!paths.every(
				(path): path is string =>
					typeof path === 'string' && safePath(path)
			)
		)
			return;
		return { createdAt, bytes, paths };
	} catch {
		return;
	}
};

/** Persist only the explicitly namespaced browser assets from the executable.
 * Use the same directory across releases; no server source or runtime metadata
 * enters this archive. Publication is atomic and a failed write leaves the old
 * graph intact. The compiled server always serves its current graph in memory.
 */
export const createClientAssetArchive = async (
	assets: Record<string, string | Blob>,
	directory = resolve(
		process.env.ABSOLUTE_ASSET_ARCHIVE_DIR || '.absolutejs/client-assets'
	),
	now = Date.now()
) => {
	const groups = new Map<string, Array<[string, string | Blob]>>();
	for (const [url, file] of Object.entries(assets)) {
		if (!url.startsWith(PREFIX)) continue;
		const [id, ...parts] = url.slice(PREFIX.length).split('/');
		const path = parts.join('/');
		if (!id || !ID.test(id) || !safePath(path)) continue;
		const group = groups.get(id) ?? [];
		group.push([path, file]);
		groups.set(id, group);
	}
	await mkdir(directory, { recursive: true });
	for (const [id, entries] of groups) {
		const destination = join(directory, id);
		if (await readManifest(destination)) continue;
		const temporary = join(directory, `.pending-${randomUUID()}`);
		try {
			let bytes = 0;
			for (const [path, source] of entries) {
				const file =
					typeof source === 'string' ? Bun.file(source) : source;
				bytes += file.size;
				if (bytes > MAX_BYTES)
					throw new Error(
						'Client asset graph exceeds archive byte limit'
					);
				const target = join(temporary, 'files', path);
				await mkdir(dirname(target), { recursive: true });
				await Bun.write(target, file);
			}
			await writeFile(
				join(temporary, 'graph.json'),
				JSON.stringify({
					createdAt: now,
					bytes,
					paths: entries.map(([path]) => path)
				})
			);
			try {
				await rename(temporary, destination);
			} catch (error) {
				if (!(await readManifest(destination))) throw error;
			}
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	}
	const graphs: Array<{ id: string; manifest: GraphManifest }> = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && /^\.pending-[a-f0-9-]+$/.test(entry.name)) {
			const path = join(directory, entry.name);
			if (now - (await stat(path)).mtimeMs > MAX_AGE_MS)
				await rm(path, { force: true, recursive: true });
			continue;
		}
		if (!entry.isDirectory() || !ID.test(entry.name)) continue;
		const manifest = await readManifest(join(directory, entry.name));
		if (manifest) graphs.push({ id: entry.name, manifest });
	}
	graphs.sort(
		(a, b) =>
			Number(groups.has(b.id)) - Number(groups.has(a.id)) ||
			b.manifest.createdAt - a.manifest.createdAt
	);
	let bytes = 0;
	let count = 0;
	const retained = new Map<string, Set<string>>();
	for (const graph of graphs) {
		const expired = now - graph.manifest.createdAt > MAX_AGE_MS;
		if (
			!groups.has(graph.id) &&
			(expired ||
				count >= MAX_GRAPHS ||
				bytes + graph.manifest.bytes > MAX_BYTES)
		) {
			await rm(join(directory, graph.id), {
				force: true,
				recursive: true
			});
			continue;
		}
		count++;
		bytes += graph.manifest.bytes;
		retained.set(graph.id, new Set(graph.manifest.paths));
	}
	return async (pathname: string): Promise<Blob | undefined> => {
		if (!pathname.startsWith(PREFIX)) return;
		const [id, ...parts] = pathname.slice(PREFIX.length).split('/');
		const path = parts.join('/');
		if (!id || !safePath(path) || !retained.get(id)?.has(path)) return;
		const file = join(directory, id, 'files', path);
		try {
			if (!(await stat(file)).isFile()) return;
		} catch {
			return;
		}
		return Bun.file(file);
	};
};
