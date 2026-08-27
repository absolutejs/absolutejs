import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PwaConfig } from '../../types/build';
import { projectImportsAbsoluteDeviceCapability } from '../mobile/deviceCapabilities';
import { discoverAbsoluteSyncSchema } from '../mobile/syncSchema';

const BOOTSTRAP_PUBLIC_PATH = '/__absolute/pwa/bootstrap.js';
const BOOTSTRAP_MARKER = 'data-absolute-pwa';

const publicFilePath = (
	value: string | undefined,
	fallback: string,
	field: string
) => {
	const input = value ?? fallback;
	if (!input.startsWith('/') || input.startsWith('//')) {
		throw new TypeError(`${field} must be an absolute same-origin path.`);
	}
	let url: URL;
	try {
		url = new URL(input, 'https://absolute.invalid');
	} catch {
		throw new TypeError(`${field} must be an absolute same-origin path.`);
	}
	if (
		url.origin !== 'https://absolute.invalid' ||
		url.search ||
		url.hash ||
		url.pathname === '/'
	) {
		throw new TypeError(
			`${field} must be a file path without query or hash.`
		);
	}
	for (const part of input.split('/')) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(part);
		} catch {
			throw new TypeError(`${field} contains invalid URL encoding.`);
		}
		if (decoded === '.' || decoded === '..' || decoded.includes('\\')) {
			throw new TypeError(
				`${field} must not contain traversal segments.`
			);
		}
	}

	return url.pathname;
};

const destinationFor = (buildPath: string, publicPath: string) =>
	join(buildPath, ...publicPath.split('/').filter(Boolean));

const bootstrapEntrySource = ({
	clientModule,
	manifestPath,
	push,
	serviceWorkerPath,
	sync
}: {
	clientModule: string;
	manifestPath?: string;
	push?: false | import('@absolutejs/pwa/client').PwaPushOptions;
	serviceWorkerPath: string;
	sync?: false | import('@absolutejs/pwa/client').PwaSyncOptions;
}) => `import { registerServiceWorker } from ${JSON.stringify(clientModule)};
${
	manifestPath
		? `const manifest = document.querySelector('link[rel="manifest"]') ?? document.createElement('link');
manifest.setAttribute('rel', 'manifest');
manifest.setAttribute('href', ${JSON.stringify(manifestPath)});
if (!manifest.isConnected) document.head.append(manifest);
`
		: ''
}await registerServiceWorker(${JSON.stringify(serviceWorkerPath)}, {
	deferUntilLoad: false${
		sync
			? `,
	sync: ${JSON.stringify(sync)}`
			: ''
	}
${
	push
		? `,
	push: ${JSON.stringify(push)}`
		: ''
}
});
`;

const injectionSource = () => `if (typeof window !== 'undefined') {
	await import(new URL(${JSON.stringify(BOOTSTRAP_PUBLIC_PATH)}, window.location.origin).href);
}
`;

export const injectPwaBootstrapHtml = (html: string) => {
	if (html.includes(BOOTSTRAP_MARKER)) return html;
	const script = `<script type="module" src="${BOOTSTRAP_PUBLIC_PATH}" ${BOOTSTRAP_MARKER}></script>`;
	const closingHead = html.toLowerCase().indexOf('</head>');
	if (closingHead >= 0) {
		return `${html.slice(0, closingHead)}${script}${html.slice(closingHead)}`;
	}

	return `${script}${html}`;
};

export type AbsolutePwaBuildArtifacts = {
	bootstrapBanner: string;
	bootstrapPublicPath: string;
	manifestPath?: string;
	serviceWorkerPath: string;
};

export const materializeAbsolutePwa = async ({
	buildPath,
	config,
	generatedRoot,
	projectRoot,
	write = true
}: {
	buildPath: string;
	config: PwaConfig;
	generatedRoot: string;
	projectRoot: string;
	/** Incremental HMR builds reuse the stable artifacts from the full build. */
	write?: boolean;
}): Promise<AbsolutePwaBuildArtifacts> => {
	const serviceWorkerPath = publicFilePath(
		config.serviceWorkerPath,
		'/sw.js',
		'pwa.serviceWorkerPath'
	);
	if (serviceWorkerPath.slice(1).includes('/')) {
		throw new TypeError(
			'pwa.serviceWorkerPath must be a root-level file so its default service-worker scope covers the application.'
		);
	}
	const manifestPath = config.manifest
		? publicFilePath(
				config.manifest.path,
				'/manifest.webmanifest',
				'pwa.manifest.path'
			)
		: undefined;
	const artifacts: AbsolutePwaBuildArtifacts = {
		bootstrapBanner: injectionSource(),
		bootstrapPublicPath: BOOTSTRAP_PUBLIC_PATH,
		manifestPath,
		serviceWorkerPath
	};
	if (!write) return artifacts;
	const pushRequested =
		config.push !== false &&
		(config.push !== undefined ||
			projectImportsAbsoluteDeviceCapability(
				projectRoot,
				'pushNotifications'
			));
	const configuredPush =
		typeof config.push === 'object' ? config.push : undefined;
	const pushRoute = pushRequested
		? publicFilePath(configuredPush?.route, '/auth/push', 'pwa.push.route')
		: undefined;
	const pushApplicationServerKey = pushRequested
		? (
				configuredPush?.applicationServerKey ??
				process.env.VAPID_PUBLIC_KEY
			)?.trim()
		: undefined;
	if (pushRequested && !pushApplicationServerKey)
		throw new TypeError(
			'Web Push is used, but no public VAPID key is configured. Set VAPID_PUBLIC_KEY for the build or pwa.push.applicationServerKey.'
		);
	const syncSchema = config.sync
		? discoverAbsoluteSyncSchema(projectRoot)
		: undefined;
	const { createWebAppManifest, pushServiceWorker } = await import(
		'@absolutejs/pwa'
	);
	const workerDestination = destinationFor(buildPath, serviceWorkerPath);
	await mkdir(dirname(workerDestination), { recursive: true });
	await writeFile(
		workerDestination,
		`${pushServiceWorker({
			...(config.serviceWorker ?? {}),
			...(pushRequested && pushApplicationServerKey && pushRoute
				? {
						resubscribe: {
							applicationServerKey: pushApplicationServerKey,
							subscribePath: pushRoute
						}
					}
				: {}),
			sync: Boolean(config.sync)
		})}\n`
	);
	if (config.manifest && manifestPath) {
		const { path: _path, ...manifestConfig } = config.manifest;
		const manifestDestination = destinationFor(buildPath, manifestPath);
		await mkdir(dirname(manifestDestination), { recursive: true });
		await writeFile(
			manifestDestination,
			`${JSON.stringify(createWebAppManifest(manifestConfig), null, '\t')}\n`
		);
	}

	const generatedDirectory = join(generatedRoot, 'pwa');
	const bootstrapEntry = join(generatedDirectory, 'bootstrap.ts');
	const clientModule = Bun.resolveSync(
		'@absolutejs/pwa/client',
		import.meta.dir
	);
	await mkdir(generatedDirectory, { recursive: true });
	await writeFile(
		bootstrapEntry,
		bootstrapEntrySource({
			clientModule,
			manifestPath,
			push:
				pushRequested && pushApplicationServerKey && pushRoute
					? {
							applicationServerKey: pushApplicationServerKey,
							endpoint: pushRoute
						}
					: false,
			serviceWorkerPath,
			sync: config.sync
				? {
						...(config.sync === true ? {} : config.sync),
						storageSchema: {
							components: syncSchema?.components ?? []
						}
					}
				: config.sync
		})
	);
	const browserDirectory = destinationFor(buildPath, '/__absolute/pwa');
	await rm(browserDirectory, { force: true, recursive: true });
	await mkdir(browserDirectory, { recursive: true });
	const result = await Bun.build({
		entrypoints: [bootstrapEntry],
		format: 'esm',
		minify: true,
		naming: {
			asset: 'asset-[hash].[ext]',
			chunk: 'chunk-[hash].[ext]',
			entry: 'bootstrap.js'
		},
		outdir: browserDirectory,
		splitting: true,
		target: 'browser'
	});
	if (!result.success) {
		throw new AggregateError(
			result.logs,
			'Failed to build the AbsoluteJS PWA bootstrap.'
		);
	}

	return artifacts;
};
