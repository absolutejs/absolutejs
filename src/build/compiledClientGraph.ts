import { createHash } from 'node:crypto';
import ts from 'typescript';
import {
	existsSync,
	readdirSync,
	readFileSync,
	mkdirSync,
	writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
	compileSpecifierRewriter,
	rewriteContentSpecifiers,
	type SpecifierRewriter
} from './specifierRewriter';

type AssetUrlEdit = { end: number; start: number; value: string };
const assetUrlEdit = (
	node: ts.Node,
	tree: ts.SourceFile,
	urls: Record<string, string>
) => {
	if (
		!ts.isNewExpression(node) ||
		!ts.isIdentifier(node.expression) ||
		node.expression.text !== 'URL'
	)
		return undefined;
	const [path, base] = node.arguments ?? [];
	if (
		!path ||
		!ts.isStringLiteral(path) ||
		base?.getText(tree) !== 'import.meta.url' ||
		!urls[path.text]
	)
		return undefined;
	const edit: AssetUrlEdit = {
		end: path.end,
		start: path.getStart(tree),
		value: JSON.stringify(urls[path.text])
	};

	return edit;
};

// Compiler-generated worker/WASM references use URL constructors rather than
// imports. Parse expressions so example strings and comments remain untouched.
const rewriteAssetUrlConstructors = (
	source: string,
	urls: Record<string, string>
) => {
	if (!/\bnew\s+URL\s*\(/u.test(source)) return source;
	const tree = ts.createSourceFile(
		'client.js',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	const edits: AssetUrlEdit[] = [];
	const visit = (node: ts.Node) => {
		const edit = assetUrlEdit(node, tree, urls);
		if (edit) edits.push(edit);
		ts.forEachChild(node, visit);
	};
	visit(tree);

	return edits
		.sort((left, right) => right.start - left.start)
		.reduce(
			(text, edit) =>
				text.slice(0, edit.start) + edit.value + text.slice(edit.end),
			source
		);
};

export const CLIENT_GRAPH_PREFIX = '/_absolute/assets/';

// Do not retain runtime metadata, source maps or generated server modules.
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
		if (entry.isDirectory()) return filesIn(path);
		if (entry.isFile()) return [path];

		return [];
	});

const readBuildManifest = (directory: string) => {
	const path = join(directory, 'manifest.json');
	const manifest: unknown = existsSync(path)
		? JSON.parse(readFileSync(path, 'utf8'))
		: {};
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
		throw new Error('Invalid build manifest');

	return manifest;
};

const withinDirectory = (directory: string, path: string) => {
	const rel = relative(directory, path);

	return rel !== '' && !isAbsolute(rel) && rel.split(/[\\/]/u)[0] !== '..';
};

const localServerDependencies = (
	file: string,
	directory: string,
	scanner: Bun.Transpiler
) => {
	if (!existsSync(file) || !/\.m?js$/.test(file)) return [];

	return scanner
		.scanImports(readFileSync(file, 'utf8'))
		.filter((dependency) => dependency.path.startsWith('.'))
		.map((dependency) => resolve(dirname(file), dependency.path))
		.filter((path) => withinDirectory(directory, path));
};

const collectServerGraph = (directory: string, manifest: object) => {
	const serverFiles = new Set(
		Object.values(manifest).filter(
			(value): value is string =>
				typeof value === 'string' && withinDirectory(directory, value)
		)
	);
	const pending = [...serverFiles];
	const scanner = new Bun.Transpiler({ loader: 'js' });
	for (let index = 0; index < pending.length; index++) {
		const file = pending[index];
		if (!file) continue;
		const children = localServerDependencies(
			file,
			directory,
			scanner
		).filter((path) => !serverFiles.has(path));
		children.forEach((path) => serverFiles.add(path));
		pending.push(...children);
	}

	return serverFiles;
};

const rewriteCssUrls = (source: string, urls: Record<string, string>) =>
	source.replace(
		/url\(\s*(["']?)(\/[^\s)'"?#]+)([^)'"\s]*)\1\s*\)/g,
		(match, quote: string, path: string, suffix: string) =>
			urls[path] ? `url(${quote}${urls[path]}${suffix}${quote})` : match
	);

const rewriteGraphAsset = (
	file: string,
	rewriter: SpecifierRewriter,
	urls: Record<string, string>
) => {
	const bytes = readFileSync(file);
	if (/\.m?js$/.test(file))
		return rewriteAssetUrlConstructors(
			rewriteContentSpecifiers(bytes.toString(), rewriter, {
				sweep: true
			}),
			urls
		);
	if (file.endsWith('.css')) return rewriteCssUrls(bytes.toString(), urls);

	return bytes;
};

const rewriteManifest = (directory: string, urls: Record<string, string>) => {
	const path = join(directory, 'manifest.json');
	if (!existsSync(path)) return;
	const manifest = readBuildManifest(directory);
	for (const [key, value] of Object.entries(manifest)) {
		if (typeof value !== 'string' || !urls[value]) continue;
		Reflect.set(manifest, key, urls[value]);
	}
	writeFileSync(path, JSON.stringify(manifest, null, '\t'));
};

/** Namespace the complete browser graph, including stable vendor filenames.
 * Relative imports stay within the graph. Original URLs remain current-release
 * aliases; application strings, API paths and SW registration scopes stay intact.
 */
export const prepareCompiledClientGraph = (
	directory: string,
	serverBundle: string,
	publicDirectory?: string
) => {
	const manifest = readBuildManifest(directory);
	const serverFiles = collectServerGraph(directory, manifest);
	const publicFiles = new Set(
		publicDirectory && existsSync(publicDirectory)
			? filesIn(publicDirectory).map((path) =>
					relative(publicDirectory, path).replace(/\\/g, '/')
				)
			: []
	);
	const clientEntries = new Set(
		Object.values(manifest)
			.filter(
				(value): value is string =>
					typeof value === 'string' &&
					value.startsWith('/') &&
					!withinDirectory(directory, value)
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
	for (const file of files)
		hash.update(relative(directory, file))
			.update('\0')
			.update(readFileSync(file))
			.update('\0');
	const id = hash.digest('hex');
	const prefix = `${CLIENT_GRAPH_PREFIX}${id}`;
	const urls: Record<string, string> = Object.create(null);
	for (const file of files) {
		const url = `/${relative(directory, file).replace(/\\/g, '/')}`;
		urls[url] = `${prefix}${url}`;
	}
	const rewriter = compileSpecifierRewriter(urls);
	for (const file of files) {
		const destination = join(
			directory,
			prefix.slice(1),
			relative(directory, file)
		);
		mkdirSync(dirname(destination), { recursive: true });
		const bytes = rewriteGraphAsset(file, rewriter, urls);
		writeFileSync(destination, bytes);
		writeFileSync(file, bytes);
	}
	rewriteManifest(directory, urls);

	return id;
};
