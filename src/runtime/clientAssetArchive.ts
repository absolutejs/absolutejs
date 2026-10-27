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
const GRAPH_ID = /^[a-f0-9]{64}$/;
const MAX_GRAPHS = 3;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024 * 1024;

type GraphManifest = { bytes: number; createdAt: number; paths: string[] };
type StoredGraph = { id: string; manifest: GraphManifest };
type AssetEntry = [string, string | Blob];
const safePath = (path: string) =>
	path.length > 0 &&
	!path.includes('\\') &&
	!path.includes('\0') &&
	path
		.split('/')
		.every((part) => part.length > 0 && part !== '.' && part !== '..');
const sequentially = <Value>(
	items: Value[],
	action: (value: Value) => Promise<void>
) =>
	items.reduce<Promise<void>>(
		(pending, value) => pending.then(() => action(value)),
		Promise.resolve()
	);

const readManifest = async (directory: string) => {
	try {
		const value: unknown = JSON.parse(
			await readFile(join(directory, 'graph.json'), 'utf8')
		);
		if (!value || typeof value !== 'object') return undefined;
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
			return undefined;
		const manifest: GraphManifest = { bytes, createdAt, paths };

		return manifest;
	} catch {
		return undefined;
	}
};

const commitGraph = async (temporary: string, destination: string) => {
	try {
		await rename(temporary, destination);
	} catch (error) {
		if (!(await readManifest(destination))) throw error;
	}
};

const sourceFile = (source: string | Blob) =>
	typeof source === 'string' ? Bun.file(source) : source;
const graphBytes = (entries: AssetEntry[]) =>
	entries.reduce((bytes, [, source]) => bytes + sourceFile(source).size, 0);
const publishGraph = async (
	directory: string,
	id: string,
	entries: AssetEntry[],
	now: number
) => {
	const destination = join(directory, id);
	if (await readManifest(destination)) return;
	const bytes = graphBytes(entries);
	if (bytes > MAX_BYTES)
		throw new Error('Client asset graph exceeds archive byte limit');
	const temporary = join(directory, `.pending-${randomUUID()}`);
	const manifest: GraphManifest = {
		bytes,
		createdAt: now,
		paths: entries.map(([path]) => path)
	};
	try {
		await sequentially(entries, async ([path, source]) => {
			const target = join(temporary, 'files', path);
			await mkdir(dirname(target), { recursive: true });
			await Bun.write(target, sourceFile(source));
		});
		await writeFile(
			join(temporary, 'graph.json'),
			JSON.stringify(manifest)
		);
		await commitGraph(temporary, destination);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
};

const cleanAbandonedStage = async (path: string, now: number) => {
	if (now - (await stat(path)).mtimeMs <= MAX_AGE_MS) return;
	await rm(path, { force: true, recursive: true });
};

const listGraphs = async (directory: string, now: number) => {
	const graphs: StoredGraph[] = [];
	await sequentially(
		await readdir(directory, { withFileTypes: true }),
		async (entry) => {
			if (!entry.isDirectory()) return;
			const path = join(directory, entry.name);
			if (/^\.pending-[a-f0-9-]+$/.test(entry.name)) {
				await cleanAbandonedStage(path, now);
				return;
			}
			if (!GRAPH_ID.test(entry.name)) return;
			const manifest = await readManifest(path);
			if (manifest) graphs.push({ id: entry.name, manifest });
		}
	);

	return graphs;
};

const collectGraphs = (assets: Record<string, string | Blob>) => {
	const groups = new Map<string, AssetEntry[]>();
	for (const [url, file] of Object.entries(assets)) {
		if (!url.startsWith(PREFIX)) continue;
		const [id, ...parts] = url.slice(PREFIX.length).split('/');
		const path = parts.join('/');
		if (!id || !GRAPH_ID.test(id) || !safePath(path)) continue;
		const group = groups.get(id) ?? [];
		group.push([path, file]);
		groups.set(id, group);
	}

	return groups;
};

const findRetainedAsset = async (
	directory: string,
	retained: Map<string, Set<string>>,
	pathname: string
) => {
	if (!pathname.startsWith(PREFIX)) return undefined;
	const [id, ...parts] = pathname.slice(PREFIX.length).split('/');
	const path = parts.join('/');
	if (!id || !safePath(path) || !retained.get(id)?.has(path))
		return undefined;
	const file = join(directory, id, 'files', path);
	try {
		if (!(await stat(file)).isFile()) return undefined;
	} catch {
		return undefined;
	}

	return Bun.file(file);
};

/** Persist only explicitly namespaced browser assets in a directory shared by
 * releases. Atomic publication preserves previous graphs on failure; sequential
 * writes bound memory. Current assets are always served from the executable.
 */
export const createClientAssetArchive = async (
	assets: Record<string, string | Blob>,
	directory = resolve(
		process.env.ABSOLUTE_ASSET_ARCHIVE_DIR || '.absolutejs/client-assets'
	),
	now = Date.now()
) => {
	const groups = collectGraphs(assets);
	const currentBytes = [...groups.values()].reduce(
		(bytes, entries) => bytes + graphBytes(entries),
		0
	);
	if (currentBytes > MAX_BYTES || groups.size > MAX_GRAPHS)
		throw new Error('Current client graphs exceed archive limits');
	await mkdir(directory, { recursive: true });
	await sequentially([...groups], ([id, entries]) =>
		publishGraph(directory, id, entries, now)
	);
	const graphs = await listGraphs(directory, now);
	graphs.sort(
		(a, b) =>
			Number(groups.has(b.id)) - Number(groups.has(a.id)) ||
			b.manifest.createdAt - a.manifest.createdAt
	);
	let bytes = 0;
	let count = 0;
	const retained = new Map<string, Set<string>>();
	await sequentially(graphs, async (graph) => {
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

			return;
		}
		count++;
		bytes += graph.manifest.bytes;
		retained.set(graph.id, new Set(graph.manifest.paths));
	});

	return (pathname: string) =>
		findRetainedAsset(directory, retained, pathname);
};
