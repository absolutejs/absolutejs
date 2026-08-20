import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import type {
	AbsoluteMobileCompatibilityArtifact,
	AbsoluteMobileCompatibilityPage
} from './releaseArtifact';
import { resolveAbsoluteMobileRoute } from './routeMatcher';
import {
	ABSOLUTE_MOBILE_CLIENT_MANIFEST_FORMAT,
	type AbsoluteMobileClientManifest
} from './transport';

export type AbsoluteCapacitorBundleOptions = {
	artifact: AbsoluteMobileCompatibilityArtifact;
	buildDirectory: string;
	config: NormalizedAbsoluteMobileConfig;
};

const MANIFEST_FILE = 'absolute-mobile-manifest.json';
const BOOTSTRAP_FILE = 'absolute-mobile-bootstrap.js';
const INDEX_FILE = 'index.html';
const CLIENT_IMPORT_PATTERN =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\/[^"']+)["']/gu;

const errorHasCode = (error: unknown, code: string) =>
	typeof error === 'object' &&
	error !== null &&
	Reflect.get(error, 'code') === code;

const shellBootstrapModule = () => {
	const candidate = ['js', 'ts']
		.map((extension) =>
			join(import.meta.dir, `shellBootstrap.${extension}`)
		)
		.find(existsSync);
	if (candidate) return candidate;

	throw new TypeError('AbsoluteJS mobile shell bootstrap module is missing.');
};

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

const indexHtml = (appName: string) => `<!doctype html>
<html>
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
		<meta name="color-scheme" content="light dark">
		<title>${escapeHtml(appName)}</title>
	</head>
	<body>
		<main id="absolute-mobile-status" role="status">Starting…</main>
		<script type="module" src="./${BOOTSTRAP_FILE}"></script>
	</body>
</html>
`;

const sourceAssetPath = (buildDirectory: string, bundlePath: string) => {
	const root = resolve(buildDirectory);
	const asset = resolve(root, bundlePath.replace(/^\/+/, ''));
	if (!asset.startsWith(`${root}/`)) {
		throw new TypeError('Mobile page bundle escaped the build directory.');
	}

	return asset;
};

const buildShellBootstrap = async (staging: string) => {
	const modulePath = shellBootstrapModule();
	const entryPath = join(staging, '.absolute-mobile-entry.ts');
	await writeFile(
		entryPath,
		`import { startAbsoluteMobileShell } from ${JSON.stringify(modulePath)};\nvoid startAbsoluteMobileShell();\n`
	);
	const build = await Bun.build({
		entrypoints: [entryPath],
		minify: true,
		outdir: staging,
		target: 'browser'
	});
	if (!build.success || build.outputs.length !== 1) {
		throw new AggregateError(
			build.logs,
			'Failed to build the AbsoluteJS Capacitor shell.'
		);
	}
	await rename(build.outputs[0]?.path ?? '', join(staging, BOOTSTRAP_FILE));
	await rm(entryPath, { force: true });
};

const removePreviousBundle = async (backup: string, moved: boolean) => {
	if (!moved) return;
	await rm(backup, { force: true, recursive: true });
};

const restorePreviousBundle = async (
	backup: string,
	destination: string,
	moved: boolean
) => {
	if (!moved) return;
	await rename(backup, destination);
};

const installBundle = async (staging: string, destination: string) => {
	const backup = `${destination}.previous-${crypto.randomUUID()}`;
	let movedPrevious = false;
	try {
		await rename(destination, backup);
		movedPrevious = true;
	} catch (error) {
		if (!errorHasCode(error, 'ENOENT')) throw error;
	}
	try {
		await rename(staging, destination);
		await removePreviousBundle(backup, movedPrevious);
	} catch (error) {
		await restorePreviousBundle(backup, destination, movedPrevious);

		throw error;
	}
};

const copyClientPage = async (
	page: AbsoluteMobileCompatibilityPage,
	buildDirectory: string,
	staging: string,
	copiedDependencies: Set<string>
) => {
	if (page.framework !== 'react') {
		throw new TypeError(
			`Capacitor spike currently supports React pages; ${page.pageId} is ${page.framework}.`
		);
	}
	const extension = extname(page.bundlePath) || '.js';
	const localBundlePath = `./pages/${page.bundleHash}${extension}`;
	const source = sourceAssetPath(buildDirectory, page.bundlePath);
	await copyFile(source, join(staging, localBundlePath));
	await copyAbsoluteClientDependencies(
		source,
		buildDirectory,
		staging,
		copiedDependencies
	);

	return { ...page, localBundlePath };
};

const absoluteClientImports = async (sourcePath: string) => {
	const source = await readFile(sourcePath, 'utf8');

	return [...source.matchAll(CLIENT_IMPORT_PATTERN)].flatMap((match) => {
		const [specifier] = match.slice(1);

		return specifier ? [specifier.split(/[?#]/u, 1)[0] ?? specifier] : [];
	});
};

const copyAbsoluteClientDependency = async (
	specifier: string,
	buildDirectory: string,
	staging: string,
	copied: Set<string>
) => {
	if (copied.has(specifier)) return;
	copied.add(specifier);
	const source = sourceAssetPath(buildDirectory, specifier);
	const destination = join(staging, specifier.replace(/^\/+/, ''));
	await mkdir(dirname(destination), { recursive: true });
	await copyFile(source, destination);
	await copyAbsoluteClientDependencies(
		source,
		buildDirectory,
		staging,
		copied
	);
};

const copyAbsoluteClientDependencies = async (
	sourcePath: string,
	buildDirectory: string,
	staging: string,
	copied: Set<string>
) => {
	const dependencies = await absoluteClientImports(sourcePath);
	await Promise.all(
		dependencies.map((specifier) =>
			copyAbsoluteClientDependency(
				specifier,
				buildDirectory,
				staging,
				copied
			)
		)
	);
};

export const materializeAbsoluteCapacitorWebBundle = async (
	options: AbsoluteCapacitorBundleOptions
) => {
	if (
		!resolveAbsoluteMobileRoute(
			options.artifact.routes,
			new URL(options.config.entry, 'https://absolute.invalid').pathname
		)
	) {
		throw new TypeError(
			`mobile.entry ${options.config.entry} is not a captured mobile page route.`
		);
	}
	const destination = options.config.bundleDirectory;
	await mkdir(dirname(destination), { recursive: true });
	const staging = await mkdtemp(
		join(dirname(destination), `.${basename(destination)}.stage-`)
	);
	try {
		const pageDirectory = join(staging, 'pages');
		await mkdir(pageDirectory, { recursive: true });
		const copiedDependencies = new Set<string>();
		const pages = await Promise.all(
			options.artifact.pages.map((page) =>
				copyClientPage(
					page,
					options.buildDirectory,
					staging,
					copiedDependencies
				)
			)
		);
		const manifest = {
			appBuild: options.artifact.appBuild,
			appId: options.config.appId,
			appName: options.config.appName,
			deepLinkHosts: options.config.deepLinkHosts,
			deepLinkScheme: options.config.deepLinkScheme,
			entry: options.config.entry,
			format: ABSOLUTE_MOBILE_CLIENT_MANIFEST_FORMAT,
			pages,
			productionOrigin: options.config.productionOrigin,
			routes: options.artifact.routes,
			runtime: options.artifact.runtime
		} satisfies AbsoluteMobileClientManifest;
		await Promise.all([
			writeFile(
				join(staging, MANIFEST_FILE),
				`${JSON.stringify(manifest, null, '\t')}\n`
			),
			writeFile(
				join(staging, INDEX_FILE),
				indexHtml(options.config.appName)
			),
			buildShellBootstrap(staging)
		]);
		await installBundle(staging, destination);

		return manifest;
	} catch (error) {
		await rm(staging, { force: true, recursive: true });

		throw error;
	}
};
