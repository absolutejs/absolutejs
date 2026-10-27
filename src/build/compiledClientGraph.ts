import { createHash } from 'node:crypto';
import {
	existsSync,
	readdirSync,
	readFileSync,
	mkdirSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
	compileSpecifierRewriter,
	rewriteContentSpecifiers
} from './specifierRewriter';

export const CLIENT_GRAPH_PREFIX = '/_absolute/assets/';

// Only browser assets belong in a retained graph. Never copy runtime modules,
// build metadata, source maps, source files or generated server bundles.
export const isClientGraphAsset = (path: string) => {
	const parts = path.split('/');
	if (
		parts.some(
			(part) =>
				part.startsWith('.') ||
				[
					'server',
					'node_modules',
					'_absolute',
					'_prerendered'
				].includes(part)
		)
	)
		return false;
	if (/^(?:react|vue|svelte|angular|ember)\/pages\//.test(path)) return false;
	return /\.(?:js|mjs|css|wasm|woff2?|ttf|otf|png|jpe?g|svg|gif|webp|avif|ico)$/.test(
		path
	);
};

const filesIn = (root: string): string[] =>
	readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		return entry.isDirectory()
			? filesIn(path)
			: entry.isFile()
				? [path]
				: [];
	});

/** Namespace the complete browser graph, including stable vendor filenames.
 * Relative imports stay relative within the same graph. Only known asset URLs
 * in module specifiers and CSS URLs change; application strings/API URLs do not.
 * Original URLs remain current-release aliases for public assets and SW scopes.
 */
export const prepareCompiledClientGraph = (
	directory: string,
	serverBundle: string,
	publicDirectory?: string
) => {
	const manifestPath = join(directory, 'manifest.json');
	const originalManifest: unknown = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, 'utf8'))
		: {};
	if (
		!originalManifest ||
		typeof originalManifest !== 'object' ||
		Array.isArray(originalManifest)
	)
		throw new Error('Invalid build manifest');
	const serverFiles = new Set(
		Object.values(originalManifest).filter(
			(value): value is string =>
				typeof value === 'string' &&
				value.startsWith(resolve(directory) + '/')
		)
	);
	// Exclude the transitive SSR module graph too, not just manifest entrypoints.
	// Server-only chunks can contain private application code.
	const pendingServer = [...serverFiles];
	const scanner = new Bun.Transpiler({ loader: 'js' });
	for (let i = 0; i < pendingServer.length; i++) {
		const file = pendingServer[i];
		if (!file || !existsSync(file) || !/\.m?js$/.test(file)) continue;
		for (const dependency of scanner.scanImports(
			readFileSync(file, 'utf8')
		)) {
			if (!dependency.path.startsWith('.')) continue;
			const target = resolve(dirname(file), dependency.path);
			if (
				!target.startsWith(resolve(directory) + '/') ||
				serverFiles.has(target)
			)
				continue;
			serverFiles.add(target);
			pendingServer.push(target);
		}
	}
	const publicFiles = new Set(
		publicDirectory && existsSync(publicDirectory)
			? filesIn(publicDirectory).map((path) =>
					relative(publicDirectory, path).replace(/\\/g, '/')
				)
			: []
	);
	const clientEntries = new Set(
		Object.values(originalManifest)
			.filter(
				(value): value is string =>
					typeof value === 'string' &&
					value.startsWith('/') &&
					!value.startsWith(resolve(directory) + '/')
			)
			.map((value) => value.slice(1))
	);
	const files = filesIn(directory)
		.filter((path) => {
			const name = relative(directory, path).replace(/\\/g, '/');
			return (
				name !== serverBundle &&
				!serverFiles.has(path) &&
				isClientGraphAsset(name) &&
				(publicFiles.has(name) ||
					clientEntries.has(name) ||
					/^(?:chunk-[^/]+|(?:vue|react|svelte|angular|ember|islands|workers|assets|vendor)\/)/.test(
						name
					))
			);
		})
		.sort();
	const hash = createHash('sha256');
	for (const file of files) {
		hash.update(relative(directory, file))
			.update('\0')
			.update(readFileSync(file))
			.update('\0');
	}
	const id = hash.digest('hex');
	const prefix = `${CLIENT_GRAPH_PREFIX}${id}`;
	const urls: Record<string, string> = Object.create(null);
	for (const file of files) {
		const url = `/${relative(directory, file).replace(/\\/g, '/')}`;
		urls[url] = `${prefix}${url}`;
	}
	const rewriter = compileSpecifierRewriter(urls);
	for (const file of files) {
		const rel = relative(directory, file);
		const destination = join(directory, prefix.slice(1), rel);
		mkdirSync(dirname(destination), { recursive: true });
		let bytes: string | Buffer = readFileSync(file);
		if (/\.m?js$/.test(file)) {
			bytes = rewriteContentSpecifiers(bytes.toString(), rewriter, {
				sweep: true
			});
		} else if (file.endsWith('.css')) {
			bytes = bytes
				.toString()
				.replace(
					/url\(\s*(["']?)(\/[^\s)'"?#]+)([^)'"\s]*)\1\s*\)/g,
					(match, quote: string, path: string, suffix: string) =>
						urls[path]
							? `url(${quote}${urls[path]}${suffix}${quote})`
							: match
				);
		}
		writeFileSync(destination, bytes);
		// The aliases also import the namespaced vendors. Keep API strings and
		// service-worker registration URLs intact.
		writeFileSync(file, bytes);
	}
	if (existsSync(manifestPath)) {
		const manifest: unknown = JSON.parse(
			readFileSync(manifestPath, 'utf8')
		);
		if (
			!manifest ||
			typeof manifest !== 'object' ||
			Array.isArray(manifest)
		)
			throw new Error('Invalid build manifest');
		for (const [key, value] of Object.entries(manifest)) {
			if (typeof value === 'string' && urls[value])
				Reflect.set(manifest, key, urls[value]);
		}
		writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
	}
	return id;
};
