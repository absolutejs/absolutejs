import {
	cp,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
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
import type { AbsoluteMobileAuthManifest } from './nativeAuth';
import type { SyncLocalStoreSchemaBundle } from '@absolutejs/sync/client';
import type { AbsoluteDeviceCapabilityPlan } from './deviceCapabilities';

export type AbsoluteCapacitorBundleOptions = {
	artifact: AbsoluteMobileCompatibilityArtifact;
	auth?: AbsoluteMobileAuthManifest;
	buildDirectory: string;
	config: NormalizedAbsoluteMobileConfig;
	deviceCapabilities: AbsoluteDeviceCapabilityPlan;
	projectRoot: string;
	sync?: boolean;
	syncSchema?: SyncLocalStoreSchemaBundle;
};

const MANIFEST_FILE = 'absolute-mobile-manifest.json';
const BOOTSTRAP_FILE = 'absolute-mobile-bootstrap.js';
const INDEX_FILE = 'index.html';
const CLIENT_CSS_DEPENDENCY_PATTERN =
	/(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?((?:\/|\.\.\/|\.\/)[^"')\s]+)["']?\s*\)?/gu;
const CLIENT_MARKUP_DEPENDENCY_PATTERN =
	/<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref|img\b[^>]*\bsrc|source\b[^>]*\bsrcset)\s*=\s*["']((?:\/|\.\.\/|\.\/)[^"',\s]+)/giu;
const CAPACITOR_CLIENT_FRAMEWORKS = new Set([
	'angular',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
]);
const CLIENT_ASSET_DIRECTORIES = ['assets', 'html', 'htmx', 'indexes'] as const;

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

const shellAuthModule = () => {
	const candidate = ['js', 'ts']
		.map((extension) => join(import.meta.dir, `shellAuth.${extension}`))
		.find(existsSync);
	if (candidate) return candidate;

	throw new TypeError('AbsoluteJS mobile auth shell module is missing.');
};

const shellExpoAuthModule = () => {
	const candidate = ['js', 'ts']
		.map((extension) => join(import.meta.dir, `shellExpoAuth.${extension}`))
		.find(existsSync);
	if (candidate) return candidate;

	throw new TypeError('AbsoluteJS Expo auth bridge module is missing.');
};

const shellSyncModule = () => {
	const candidate = ['js', 'ts']
		.map((extension) => join(import.meta.dir, `shellSync.${extension}`))
		.find(existsSync);
	if (candidate) return candidate;

	throw new TypeError('AbsoluteJS mobile Sync shell module is missing.');
};

const shellPushModule = () => {
	const candidate = ['js', 'ts']
		.map((extension) => join(import.meta.dir, `shellPush.${extension}`))
		.find(existsSync);
	if (candidate) return candidate;

	throw new TypeError('AbsoluteJS mobile push shell module is missing.');
};

const shellExpoDevicesModule = () => {
	const candidate = ['js', 'ts']
		.map((extension) =>
			join(import.meta.dir, `shellExpoDevices.${extension}`)
		)
		.find(existsSync);
	if (candidate) return candidate;

	throw new TypeError('AbsoluteJS Expo device bridge module is missing.');
};

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

const contentSecurityPolicy = (productionOrigin: string) => {
	const backend = new URL(productionOrigin);
	const socketOrigin = `${backend.protocol === 'https:' ? 'wss:' : 'ws:'}//${backend.host}`;

	return [
		"default-src 'self' data: blob: https:",
		"base-uri 'none'",
		"object-src 'none'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		`connect-src 'self' ${backend.origin} ${socketOrigin}`,
		"form-action 'none'"
	].join('; ');
};

const indexHtml = (
	appName: string,
	productionOrigin: string
) => `<!doctype html>
<html>
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
		<meta name="color-scheme" content="light dark">
		<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(productionOrigin))}">
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

const importEntryTarget = (entry: unknown) => {
	if (typeof entry === 'string') return entry;
	if (typeof entry === 'object' && entry !== null)
		return Reflect.get(entry, 'import');

	return undefined;
};

const resolveProjectImport = async (projectRoot: string, specifier: string) => {
	const segments = specifier.split('/');
	const packageName = specifier.startsWith('@')
		? segments.slice(0, 2).join('/')
		: (segments[0] ?? '');
	const subpath = specifier.slice(packageName.length);
	const packageDirectory = join(
		resolve(projectRoot),
		'node_modules',
		packageName
	);
	const manifest: unknown = JSON.parse(
		await readFile(join(packageDirectory, 'package.json'), 'utf8')
	);
	const exports =
		typeof manifest === 'object' && manifest !== null
			? Reflect.get(manifest, 'exports')
			: undefined;
	const entry =
		typeof exports === 'object' && exports !== null
			? Reflect.get(exports, subpath ? `.${subpath}` : '.')
			: undefined;
	const target = importEntryTarget(entry);
	if (typeof target !== 'string' || !target.startsWith('./'))
		throw new TypeError(`${specifier} does not publish an import entry.`);
	const resolved = resolve(packageDirectory, target);
	if (!resolved.startsWith(`${resolve(packageDirectory)}/`))
		throw new TypeError(`${specifier} has an unsafe import entry.`);

	return resolved;
};

const buildShellBootstrap = async (
	staging: string,
	auth: boolean,
	sync: boolean,
	storagePrefix: string,
	engine: 'capacitor' | 'expo',
	deviceCapabilities: AbsoluteDeviceCapabilityPlan,
	projectRoot: string
) => {
	const capacitor = engine !== 'expo';
	const shellCapabilities = capacitor ? deviceCapabilities.capabilities : [];
	const modulePath = shellBootstrapModule();
	const authFactory = capacitor
		? 'createAbsoluteMobileShellAuth'
		: 'createAbsoluteExpoShellAuth';
	const authImport = auth
		? `import { ${authFactory} } from ${JSON.stringify(capacitor ? shellAuthModule() : shellExpoAuthModule())};\n`
		: '';
	const options = auth
		? `{ createAuth: ${authFactory}${sync ? ', installSync: installAbsoluteMobileShellSync' : ''} }`
		: '';
	const syncImport = sync
		? `import { installAbsoluteMobileShellSync } from ${JSON.stringify(shellSyncModule())};\n`
		: '';
	const pushIndex = shellCapabilities.indexOf('pushNotifications');
	const push = pushIndex !== -1;
	const pushImport = push
		? `import { createAbsoluteMobileShellPush } from ${JSON.stringify(shellPushModule())};\n`
		: '';
	const capabilityImports = (
		await Promise.all(
			shellCapabilities.map(async (name, index) => {
				const provider = deviceCapabilities.providers[name];
				if (!provider)
					throw new TypeError(
						`Missing device capability provider ${name}.`
					);

				return `import { ${provider.factory} as absoluteDeviceCapability${index} } from ${JSON.stringify(await resolveProjectImport(projectRoot, provider.module))};`;
			})
		)
	).join('\n');
	const pushSetup = push
		? `const absoluteMobilePush = createAbsoluteMobileShellPush();\nconst absoluteMobilePushCapability = absoluteDeviceCapability${pushIndex}(absoluteMobilePush.capabilityOptions);\n`
		: '';
	const capabilityOptions = shellCapabilities
		.map(
			(name, index) =>
				`${JSON.stringify(name)}: ${name === 'pushNotifications' ? 'absoluteMobilePushCapability' : `absoluteDeviceCapability${index}()`}`
		)
		.join(', ');
	const entryPath = join(staging, '.absolute-mobile-entry.ts');
	const baseAdapterModule = capacitor
		? await resolveProjectImport(
				projectRoot,
				'@absolutejs/devices-capacitor'
			)
		: shellExpoDevicesModule();
	const adapterImport = capacitor
		? `import { installCapacitorDeviceAdapterIfNative } from ${JSON.stringify(baseAdapterModule)};`
		: `import { createAbsoluteExpoBridgeFetch, installAbsoluteExpoWebDeviceAdapter } from ${JSON.stringify(baseAdapterModule)};`;
	const adapterInstall = capacitor
		? `installCapacitorDeviceAdapterIfNative({ storagePrefix: ${JSON.stringify(storagePrefix)}${capabilityOptions ? `, ${capabilityOptions}` : ''} });`
		: 'installAbsoluteExpoWebDeviceAdapter();';
	let shellOptions = auth
		? options
		: '{ createFetch: createAbsoluteExpoBridgeFetch }';
	if (capacitor) shellOptions = options;
	if (push) {
		shellOptions = `{ createAuth: (config, options) => createAbsoluteMobileShellAuth(config, options), beforeSignOut: absoluteMobilePush.beforeSignOut, connectPush: (auth) => absoluteMobilePush.connect(auth, absoluteMobilePushCapability)${sync ? ', installSync: installAbsoluteMobileShellSync' : ''} }`;
	}
	await writeFile(
		entryPath,
		`import { startAbsoluteMobileShell } from ${JSON.stringify(modulePath)};\n${adapterImport}\n${authImport}${syncImport}${pushImport}${capabilityImports}\n${pushSetup}${adapterInstall}\nvoid startAbsoluteMobileShell(${shellOptions});\n`
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
	if (!CAPACITOR_CLIENT_FRAMEWORKS.has(page.framework)) {
		throw new TypeError(
			`Capacitor client rendering does not yet support ${page.framework} page ${page.pageId}.`
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

	let localStylePath: string | undefined;
	if (page.styleBundlePath && page.styleBundleHash) {
		const styleExtension = extname(page.styleBundlePath) || '.css';
		localStylePath = `./styles/${page.styleBundleHash}${styleExtension}`;
		const styleSource = sourceAssetPath(
			buildDirectory,
			page.styleBundlePath
		);
		await mkdir(dirname(join(staging, localStylePath)), {
			recursive: true
		});
		await copyFile(styleSource, join(staging, localStylePath));
		await copyAbsoluteClientDependencies(
			styleSource,
			buildDirectory,
			staging,
			copiedDependencies
		);
	}

	return {
		...page,
		localBundlePath,
		...(localStylePath ? { localStylePath } : {})
	};
};

const absoluteClientImports = async (
	sourcePath: string,
	buildDirectory: string
) => {
	const source = await readFile(sourcePath, 'utf8');
	const extension = extname(sourcePath).toLowerCase();
	let scriptLoader: 'js' | 'jsx' | 'ts' | 'tsx' | undefined;
	if (extension === '.tsx') scriptLoader = 'tsx';
	else if (extension === '.ts') scriptLoader = 'ts';
	else if (extension === '.jsx') scriptLoader = 'jsx';
	else if (['.js', '.mjs', '.cjs'].includes(extension)) scriptLoader = 'js';
	const scriptImports = scriptLoader
		? new Bun.Transpiler({ loader: scriptLoader })
				.scanImports(source)
				.map(({ path }) => path)
		: [];
	const cssImports =
		extension === '.css'
			? [...source.matchAll(CLIENT_CSS_DEPENDENCY_PATTERN)].flatMap(
					(match) => match[1] ?? []
				)
			: [];
	const markupImports =
		extension === '.html'
			? [...source.matchAll(CLIENT_MARKUP_DEPENDENCY_PATTERN)].flatMap(
					(match) => match[1] ?? []
				)
			: [];

	return [...scriptImports, ...cssImports, ...markupImports].flatMap(
		(specifier) => {
			if (!specifier) return [];
			if (
				!specifier.startsWith('/') &&
				!specifier.startsWith('./') &&
				!specifier.startsWith('../')
			) {
				return [];
			}
			const clean = specifier.split(/[?#]/u, 1)[0] ?? specifier;
			if (clean.startsWith('/')) return [clean];
			const resolved = resolve(dirname(sourcePath), clean);
			const root = resolve(buildDirectory);
			const relativePath = relative(root, resolved).replaceAll('\\', '/');
			if (relativePath === '..' || relativePath.startsWith('../')) {
				throw new TypeError(
					`Mobile client dependency escaped the build directory: ${specifier}`
				);
			}

			return [`/${relativePath}`];
		}
	);
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
	const dependencies = await absoluteClientImports(
		sourcePath,
		buildDirectory
	);
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
		await Promise.all(
			CLIENT_ASSET_DIRECTORIES.map((directory) => ({
				destination: join(staging, directory),
				source: join(options.buildDirectory, directory)
			}))
				.filter(({ source }) => existsSync(source))
				.map(({ destination: assetDestination, source }) =>
					cp(source, assetDestination, { recursive: true })
				)
		);
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
			...(options.auth ? { auth: options.auth } : {}),
			appId: options.config.appId,
			appName: options.config.appName,
			deepLinkHosts: options.config.deepLinkHosts,
			deepLinkScheme: options.config.deepLinkScheme,
			deviceCapabilities: options.deviceCapabilities.capabilities,
			entry: options.config.entry,
			format: ABSOLUTE_MOBILE_CLIENT_MANIFEST_FORMAT,
			pages,
			productionOrigin: options.config.productionOrigin,
			routes: options.artifact.routes,
			runtime: options.artifact.runtime,
			...(options.sync
				? {
						sync: {
							background: {
								endpoint: new URL(
									'/__absolute/sync/background',
									options.config.productionOrigin
								).href,
								intervalMinutes: 15
							},
							socketTickets: true as const,
							storageSchema: options.syncSchema ?? {
								components: [
									{ id: '@absolutejs/app', version: 1 }
								]
							}
						}
					}
				: {})
		} satisfies AbsoluteMobileClientManifest;
		await Promise.all([
			writeFile(
				join(staging, MANIFEST_FILE),
				`${JSON.stringify(manifest, null, '\t')}\n`
			),
			writeFile(
				join(staging, INDEX_FILE),
				indexHtml(
					options.config.appName,
					options.config.productionOrigin
				)
			),
			buildShellBootstrap(
				staging,
				options.auth !== undefined,
				options.auth !== undefined && options.sync === true,
				`absolutejs.${options.auth?.clientId ?? options.config.appId}.`,
				options.config.engine,
				options.deviceCapabilities,
				options.projectRoot
			)
		]);
		await installBundle(staging, destination);

		return manifest;
	} catch (error) {
		await rm(staging, { force: true, recursive: true });

		throw error;
	}
};
