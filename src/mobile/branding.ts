import { createHash } from 'node:crypto';
import {
	access,
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

export const ABSOLUTE_MOBILE_BRANDING_FORMAT = 1 as const;
export const ABSOLUTE_CAPACITOR_ASSETS_VERSION = '3.0.5' as const;
export const ABSOLUTE_CAPACITOR_ASSETS_SPEC =
	`@capacitor/assets@${ABSOLUTE_CAPACITOR_ASSETS_VERSION}` as const;

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const ICON_SIZE = 1024;
const SPLASH_SIZE = 2732;
const ANDROID_ADAPTIVE_SIZES = [
	['ldpi', 81],
	['mdpi', 108],
	['hdpi', 162],
	['xhdpi', 216],
	['xxhdpi', 324],
	['xxxhdpi', 432]
] as const;

type Branding = NonNullable<NormalizedAbsoluteMobileConfig['branding']>;

export type AbsoluteMobileBrandingSource = {
	bytes: number;
	height: number;
	kind:
		| 'android-background'
		| 'android-foreground'
		| 'android-monochrome'
		| 'icon'
		| 'ios-dark'
		| 'ios-tinted'
		| 'splash-dark'
		| 'splash-light';
	path: string;
	sha256: string;
	width: number;
};

export type AbsoluteMobileBrandingManifest = {
	engine: 'capacitor' | 'expo';
	fingerprint: string;
	format: typeof ABSOLUTE_MOBILE_BRANDING_FORMAT;
	platforms: ('android' | 'ios')[];
	sources: AbsoluteMobileBrandingSource[];
};

export type AbsoluteMobileBrandingInspection = {
	configured: boolean;
	detail: string;
	manifestPath: string;
	ready: boolean;
	status: 'absent' | 'invalid' | 'ready' | 'stale';
};

export type AbsoluteMobileBrandingRunner = (
	command: string[],
	options: { cwd: string }
) => Promise<void>;

const exists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const portableRelative = (root: string, path: string) =>
	relative(root, path).replaceAll('\\', '/');

export const absoluteMobileBrandingManifestPath = (projectRoot: string) =>
	join(
		resolve(projectRoot),
		'.absolutejs',
		'mobile',
		'branding',
		'manifest.json'
	);

const brandingEntries = (branding: Branding) =>
	[
		{ kind: 'icon' as const, path: branding.icon, size: ICON_SIZE },
		branding.android.foreground
			? {
					kind: 'android-foreground' as const,
					path: branding.android.foreground,
					size: ICON_SIZE
				}
			: undefined,
		branding.android.backgroundImage
			? {
					kind: 'android-background' as const,
					path: branding.android.backgroundImage,
					size: ICON_SIZE
				}
			: undefined,
		branding.android.monochrome
			? {
					kind: 'android-monochrome' as const,
					path: branding.android.monochrome,
					size: ICON_SIZE
				}
			: undefined,
		branding.ios.darkIcon
			? {
					kind: 'ios-dark' as const,
					path: branding.ios.darkIcon,
					size: ICON_SIZE
				}
			: undefined,
		branding.ios.tintedIcon
			? {
					kind: 'ios-tinted' as const,
					path: branding.ios.tintedIcon,
					size: ICON_SIZE
				}
			: undefined,
		branding.splash.image
			? {
					kind: 'splash-light' as const,
					path: branding.splash.image,
					size: SPLASH_SIZE
				}
			: undefined,
		branding.splash.darkImage
			? {
					kind: 'splash-dark' as const,
					path: branding.splash.darkImage,
					size: SPLASH_SIZE
				}
			: undefined
	].filter(
		(entry): entry is NonNullable<typeof entry> => entry !== undefined
	);

const inspectSource = async (
	projectRoot: string,
	entry: ReturnType<typeof brandingEntries>[number]
): Promise<AbsoluteMobileBrandingSource> => {
	const buffer = await readFile(entry.path);
	if (buffer.byteLength > MAX_SOURCE_BYTES)
		throw new TypeError(
			`mobile.branding ${entry.kind} exceeds the 32 MiB source limit.`
		);
	let metadata: Bun.Image.Metadata;
	try {
		metadata = await new Bun.Image(buffer, {
			maxPixels: SPLASH_SIZE * SPLASH_SIZE * 4
		}).metadata();
	} catch (error) {
		throw new TypeError(
			`mobile.branding ${entry.kind} must be a readable PNG image.`,
			{ cause: error }
		);
	}
	if (metadata.format !== 'png')
		throw new TypeError(`mobile.branding ${entry.kind} must be PNG.`);
	if (
		metadata.width !== metadata.height ||
		metadata.width < entry.size ||
		metadata.height < entry.size
	)
		throw new TypeError(
			`mobile.branding ${entry.kind} must be square and at least ${entry.size}x${entry.size}.`
		);

	return {
		bytes: buffer.byteLength,
		height: metadata.height,
		kind: entry.kind,
		path: portableRelative(projectRoot, entry.path),
		sha256: createHash('sha256').update(buffer).digest('hex'),
		width: metadata.width
	};
};

const manifestFingerprint = (
	config: NormalizedAbsoluteMobileConfig,
	sources: AbsoluteMobileBrandingSource[]
) => {
	const { branding } = config;
	if (!branding) throw new TypeError('mobile.branding is not configured.');

	return createHash('sha256')
		.update(
			JSON.stringify({
				androidBackgroundColor: branding.android.backgroundColor,
				engine: config.engine,
				format: ABSOLUTE_MOBILE_BRANDING_FORMAT,
				platforms: config.platforms,
				sources: sources.map(({ kind, sha256 }) => ({ kind, sha256 })),
				splashBackgroundColor: branding.splash.backgroundColor,
				splashDarkBackgroundColor: branding.splash.darkBackgroundColor,
				splashLogoScale: branding.splash.logoScale
			})
		)
		.digest('hex');
};

export const createAbsoluteMobileBrandingManifest = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	if (!config.branding)
		throw new TypeError(
			'absolute.config.ts must define mobile.branding before generating mobile assets.'
		);
	const sources = await Promise.all(
		brandingEntries(config.branding).map((entry) =>
			inspectSource(projectRoot, entry)
		)
	);

	return {
		engine: config.engine,
		fingerprint: manifestFingerprint(config, sources),
		format: ABSOLUTE_MOBILE_BRANDING_FORMAT,
		platforms: [...config.platforms],
		sources
	};
};

const writeManifest = async (
	projectRoot: string,
	manifest: AbsoluteMobileBrandingManifest
) => {
	const destination = absoluteMobileBrandingManifestPath(projectRoot);
	await mkdir(dirname(destination), { recursive: true });
	const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
		flag: 'wx'
	});
	await rename(temporary, destination);

	return destination;
};

const copyManaged = async (source: string, destination: string) => {
	await mkdir(dirname(destination), { recursive: true });
	await copyFile(source, destination);
};

export const absoluteExpoBrandingConfig = (
	config: NormalizedAbsoluteMobileConfig
) => {
	const { branding } = config;
	if (!branding) return undefined;
	const root = './assets/absolute-branding';
	const iosIcon =
		branding.ios.darkIcon || branding.ios.tintedIcon
			? {
					...(branding.ios.darkIcon
						? { dark: `${root}/ios-dark.png` }
						: {}),
					light: `${root}/icon.png`,
					...(branding.ios.tintedIcon
						? { tinted: `${root}/ios-tinted.png` }
						: {})
				}
			: `${root}/icon.png`;

	return {
		android: {
			adaptiveIcon: {
				backgroundColor: branding.android.backgroundColor,
				...(branding.android.backgroundImage
					? { backgroundImage: `${root}/android-background.png` }
					: {}),
				foregroundImage: branding.android.foreground
					? `${root}/android-foreground.png`
					: `${root}/icon.png`,
				...(branding.android.monochrome
					? { monochromeImage: `${root}/android-monochrome.png` }
					: {})
			},
			icon: `${root}/icon.png`
		},
		icon: `${root}/icon.png`,
		ios: { icon: iosIcon },
		splashPlugin: [
			'expo-splash-screen',
			{
				backgroundColor: branding.splash.backgroundColor,
				dark: {
					backgroundColor: branding.splash.darkBackgroundColor,
					image: branding.splash.darkImage
						? `${root}/splash-dark.png`
						: `${root}/icon.png`
				},
				image: branding.splash.image
					? `${root}/splash-light.png`
					: `${root}/icon.png`,
				imageWidth: Math.round(1024 * branding.splash.logoScale)
			}
		]
	};
};

export const writeAbsoluteExpoBrandingInputs = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const { branding } = config;
	if (!branding) return undefined;
	const manifest = await createAbsoluteMobileBrandingManifest(
		config,
		projectRoot
	);
	const destination = join(
		config.nativeProjectDirectory,
		'assets',
		'absolute-branding'
	);
	await rm(destination, { force: true, recursive: true });
	await mkdir(destination, { recursive: true });
	await copyManaged(branding.icon, join(destination, 'icon.png'));
	const copies = [
		[branding.android.backgroundImage, 'android-background.png'],
		[branding.android.foreground, 'android-foreground.png'],
		[branding.android.monochrome, 'android-monochrome.png'],
		[branding.ios.darkIcon, 'ios-dark.png'],
		[branding.ios.tintedIcon, 'ios-tinted.png'],
		[branding.splash.image, 'splash-light.png'],
		[branding.splash.darkImage, 'splash-dark.png']
	] as const;
	await Promise.all(
		copies.map(([source, name]) =>
			source ? copyManaged(source, join(destination, name)) : undefined
		)
	);
	await writeManifest(projectRoot, manifest);

	return { manifest, path: destination };
};

const stageCapacitorInputs = async (
	branding: Branding,
	projectRoot: string
) => {
	const destination = join(
		projectRoot,
		'.absolutejs',
		'mobile',
		'branding',
		'input'
	);
	await rm(destination, { force: true, recursive: true });
	await mkdir(destination, { recursive: true });
	await copyManaged(branding.icon, join(destination, 'logo.png'));
	if (branding.splash.image)
		await copyManaged(
			branding.splash.image,
			join(destination, 'splash.png')
		);
	if (branding.splash.darkImage)
		await copyManaged(
			branding.splash.darkImage,
			join(destination, 'splash-dark.png')
		);

	return destination;
};

const defaultRunner: AbsoluteMobileBrandingRunner = async (
	command,
	options
) => {
	const child = Bun.spawn(command, {
		cwd: options.cwd,
		stderr: 'pipe',
		stdin: 'inherit',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);
	if (stdout) process.stdout.write(stdout);
	if (stderr) process.stderr.write(stderr);
	if (exitCode !== 0)
		throw new TypeError(
			`Capacitor asset generation exited with status ${exitCode}.`
		);
	// The pinned upstream CLI catches generation errors and exits zero.
	// Existing template artwork must not make those failures look successful.
	if (
		/Unable to generate assets|Unable to load source image|Asset directory not found|No assets found|No platforms found|skipping (?:iOS|android) generation/iu.test(
			`${stdout}\n${stderr}`
		)
	)
		throw new TypeError(
			'Capacitor asset generation reported an incomplete projection.'
		);
};

const resizePng = async (source: string, destination: string, size: number) => {
	const output = await new Bun.Image(await readFile(source))
		.resize(size, size)
		.png({ compressionLevel: 9 })
		.toBuffer();
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, output);
};

const applyAndroidLayers = async (
	branding: Branding,
	nativeDirectory: string
) => {
	const resources = join(
		nativeDirectory,
		'android',
		'app',
		'src',
		'main',
		'res'
	);
	await Promise.all(
		ANDROID_ADAPTIVE_SIZES.flatMap(([density, size]) => [
			...(branding.android.foreground
				? [
						resizePng(
							branding.android.foreground,
							join(
								resources,
								`mipmap-${density}`,
								'ic_launcher_foreground.png'
							),
							size
						)
					]
				: []),
			...(branding.android.backgroundImage
				? [
						resizePng(
							branding.android.backgroundImage,
							join(
								resources,
								`mipmap-${density}`,
								'ic_launcher_background.png'
							),
							size
						)
					]
				: []),
			...(branding.android.monochrome
				? [
						resizePng(
							branding.android.monochrome,
							join(
								resources,
								`mipmap-${density}`,
								'ic_launcher_monochrome.png'
							),
							size
						)
					]
				: [])
		])
	);
	if (!branding.android.monochrome) return;
	const iconXml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>\n`;
	await Promise.all(
		['ic_launcher.xml', 'ic_launcher_round.xml'].map((name) =>
			writeFile(join(resources, 'mipmap-anydpi-v26', name), iconXml)
		)
	);
};

const applyIosAppearances = async (
	branding: Branding,
	nativeDirectory: string
) => {
	if (!branding.ios.darkIcon && !branding.ios.tintedIcon) return;
	const assetSet = join(
		nativeDirectory,
		'ios',
		'App',
		'App',
		'Assets.xcassets',
		'AppIcon.appiconset'
	);
	const contentsPath = join(assetSet, 'Contents.json');
	const contents: unknown = JSON.parse(await readFile(contentsPath, 'utf8'));
	const images =
		typeof contents === 'object' && contents !== null
			? Reflect.get(contents, 'images')
			: undefined;
	if (
		typeof contents !== 'object' ||
		contents === null ||
		!Array.isArray(images)
	)
		throw new TypeError('Generated iOS AppIcon Contents.json is invalid.');
	const appearanceSources: ['dark' | 'tinted', string | undefined][] = [
		['dark', branding.ios.darkIcon],
		['tinted', branding.ios.tintedIcon]
	];
	const generated = await Promise.all(
		appearanceSources.map(async ([appearance, source]) => {
			if (!source) return undefined;
			const filename = `AppIcon-1024-${appearance}.png`;
			await resizePng(source, join(assetSet, filename), ICON_SIZE);

			return {
				appearances: [{ appearance: 'luminosity', value: appearance }],
				filename,
				idiom: 'universal',
				platform: 'ios',
				size: '1024x1024'
			};
		})
	);
	const retained = images.filter((entry) => {
		if (typeof entry !== 'object' || entry === null) return true;
		const filename = Reflect.get(entry, 'filename');

		return (
			filename !== 'AppIcon-1024-dark.png' &&
			filename !== 'AppIcon-1024-tinted.png'
		);
	});
	Reflect.set(contents, 'images', [
		...retained,
		...generated.filter((entry) => entry !== undefined)
	]);
	await writeFile(contentsPath, `${JSON.stringify(contents, null, 2)}\n`);
};

const nativeBrandingSentinels = (
	config: NormalizedAbsoluteMobileConfig,
	platforms: readonly ('android' | 'ios')[]
) =>
	platforms.map((platform) =>
		platform === 'android'
			? join(
					config.nativeProjectDirectory,
					'android',
					'app',
					'src',
					'main',
					'res',
					'mipmap-xxxhdpi',
					'ic_launcher.png'
				)
			: join(
					config.nativeProjectDirectory,
					'ios',
					'App',
					'App',
					'Assets.xcassets',
					'AppIcon.appiconset',
					'AppIcon-512@2x.png'
				)
	);

const requireGeneratedBranding = async (
	config: NormalizedAbsoluteMobileConfig,
	platforms: readonly ('android' | 'ios')[]
) => {
	const missing = (
		await Promise.all(
			nativeBrandingSentinels(config, platforms).map(async (path) => ({
				path,
				present: await exists(path)
			}))
		)
	).filter(({ present }) => !present);
	if (missing.length > 0)
		throw new TypeError(
			`Capacitor asset generation did not produce ${missing.map(({ path }) => path).join(', ')}.`
		);
};

const reusableManifestPlatforms = (value: unknown, fingerprint: string) => {
	if (
		typeof value !== 'object' ||
		value === null ||
		Reflect.get(value, 'format') !== ABSOLUTE_MOBILE_BRANDING_FORMAT ||
		Reflect.get(value, 'fingerprint') !== fingerprint
	)
		return [];
	const platforms = Reflect.get(value, 'platforms');
	if (!Array.isArray(platforms)) return [];

	return platforms.flatMap((platform) =>
		platform === 'android' || platform === 'ios' ? [platform] : []
	);
};

const completedManifestPlatforms = async (
	manifest: AbsoluteMobileBrandingManifest,
	manifestPath: string,
	generated: readonly ('android' | 'ios')[]
) => {
	let previousPlatforms: ('android' | 'ios')[] = [];
	try {
		const previous: unknown = JSON.parse(
			await readFile(manifestPath, 'utf8')
		);
		previousPlatforms = reusableManifestPlatforms(
			previous,
			manifest.fingerprint
		);
	} catch {
		// A missing or invalid prior manifest cannot contribute completed work.
	}
	const completed = new Set([...generated, ...previousPlatforms]);

	return manifest.platforms.filter((platform) => completed.has(platform));
};

export const generateAbsoluteCapacitorBranding = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string,
	options: AbsoluteMobileBrandingGenerationOptions = {}
) => {
	const { branding } = config;
	if (!branding)
		throw new TypeError(
			'absolute.config.ts must define mobile.branding before generating mobile assets.'
		);
	if (config.engine !== 'capacitor')
		throw new TypeError(
			'Capacitor branding requires mobile.engine: capacitor.'
		);
	const manifest = await createAbsoluteMobileBrandingManifest(
		config,
		projectRoot
	);
	const input = await stageCapacitorInputs(branding, projectRoot);
	const platforms = options.platforms ?? config.platforms;
	const command = [
		'bun',
		'x',
		'--no-install',
		'capacitor-assets',
		'generate',
		...platforms.map((platform) => `--${platform}`),
		'--assetPath',
		portableRelative(projectRoot, input),
		'--androidProject',
		portableRelative(
			projectRoot,
			join(config.nativeProjectDirectory, 'android')
		),
		'--iosProject',
		portableRelative(
			projectRoot,
			join(config.nativeProjectDirectory, 'ios', 'App')
		),
		'--iconBackgroundColor',
		branding.android.backgroundColor,
		'--splashBackgroundColor',
		branding.splash.backgroundColor,
		'--splashBackgroundColorDark',
		branding.splash.darkBackgroundColor,
		'--logoSplashScale',
		String(branding.splash.logoScale)
	];
	await (options.runner ?? defaultRunner)(command, { cwd: projectRoot });
	await requireGeneratedBranding(config, platforms);
	if (platforms.includes('android'))
		await applyAndroidLayers(branding, config.nativeProjectDirectory);
	if (platforms.includes('ios'))
		await applyIosAppearances(branding, config.nativeProjectDirectory);
	const manifestPath = absoluteMobileBrandingManifestPath(projectRoot);
	const completedPlatforms = await completedManifestPlatforms(
		manifest,
		manifestPath,
		platforms
	);
	await writeManifest(projectRoot, {
		...manifest,
		platforms: completedPlatforms
	});

	return {
		manifest: { ...manifest, platforms: completedPlatforms },
		manifestPath,
		platforms
	};
};

export type AbsoluteMobileBrandingGenerationOptions = {
	platforms?: ('android' | 'ios')[];
	runner?: AbsoluteMobileBrandingRunner;
};

const parseManifestState = (value: unknown) => {
	const fingerprint =
		typeof value === 'object' && value !== null
			? Reflect.get(value, 'fingerprint')
			: undefined;
	if (
		typeof value !== 'object' ||
		value === null ||
		Reflect.get(value, 'format') !== ABSOLUTE_MOBILE_BRANDING_FORMAT ||
		typeof fingerprint !== 'string'
	)
		throw new TypeError('Mobile branding manifest is invalid.');

	const platforms = Reflect.get(value, 'platforms');
	if (
		!Array.isArray(platforms) ||
		platforms.some(
			(platform) => platform !== 'android' && platform !== 'ios'
		)
	)
		throw new TypeError('Mobile branding manifest platforms are invalid.');

	const validPlatforms = platforms.flatMap((platform) =>
		platform === 'android' || platform === 'ios' ? [platform] : []
	);

	return { fingerprint, platforms: new Set(validPlatforms) };
};

const brandingInspection = (value: AbsoluteMobileBrandingInspection) => value;

export const inspectAbsoluteMobileBranding = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const manifestPath = absoluteMobileBrandingManifestPath(projectRoot);
	if (!config.branding)
		return brandingInspection({
			configured: false,
			detail: 'Mobile branding is not configured; native template artwork may be shipped.',
			manifestPath,
			ready: false,
			status: 'absent'
		});
	let expected: AbsoluteMobileBrandingManifest;
	try {
		expected = await createAbsoluteMobileBrandingManifest(
			config,
			projectRoot
		);
	} catch (error) {
		return brandingInspection({
			configured: true,
			detail:
				error instanceof Error
					? error.message
					: 'Mobile branding sources are invalid.',
			manifestPath,
			ready: false,
			status: 'invalid'
		});
	}
	try {
		const current = parseManifestState(
			JSON.parse(await readFile(manifestPath, 'utf8'))
		);
		if (current.fingerprint !== expected.fingerprint)
			return brandingInspection({
				configured: true,
				detail: 'Mobile branding sources changed after the last native projection.',
				manifestPath,
				ready: false,
				status: 'stale'
			});
		const missingPlatforms = config.platforms.filter(
			(platform) => !current.platforms.has(platform)
		);
		if (missingPlatforms.length > 0)
			return brandingInspection({
				configured: true,
				detail: `Mobile branding has not been projected for ${missingPlatforms.join(', ')}.`,
				manifestPath,
				ready: false,
				status: 'stale'
			});
		const nativeSentinels =
			config.engine === 'expo'
				? [
						join(
							config.nativeProjectDirectory,
							'assets',
							'absolute-branding',
							'icon.png'
						)
					]
				: nativeBrandingSentinels(config, config.platforms);
		if (
			(
				await Promise.all(nativeSentinels.map((path) => exists(path)))
			).some((present) => !present)
		)
			return brandingInspection({
				configured: true,
				detail: 'The generated native branding projection is missing.',
				manifestPath,
				ready: false,
				status: 'stale'
			});

		return brandingInspection({
			configured: true,
			detail: `Mobile branding ${expected.fingerprint.slice(0, 12)} is current for ${config.engine}.`,
			manifestPath,
			ready: true,
			status: 'ready'
		});
	} catch {
		return brandingInspection({
			configured: true,
			detail: 'Mobile branding has not been projected into the native app.',
			manifestPath,
			ready: false,
			status: 'stale'
		});
	}
};

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

export const renderAbsoluteMobileBrandingPreview = async (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => {
	const manifest = await createAbsoluteMobileBrandingManifest(
		config,
		projectRoot
	);
	const { branding } = config;
	if (!branding) throw new TypeError('mobile.branding is not configured.');
	const destination = join(
		projectRoot,
		'.absolutejs',
		'mobile',
		'branding',
		'preview.html'
	);
	const icon = `data:image/png;base64,${(await readFile(branding.icon)).toString('base64')}`;
	const appName = escapeHtml(config.appName);
	const html = `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width">\n<title>${appName} mobile branding</title>\n<style>body{font:16px system-ui;margin:2rem;background:#eee;color:#111}main{display:flex;flex-wrap:wrap;gap:2rem}.card{background:white;border-radius:20px;padding:1.5rem;box-shadow:0 8px 30px #0002}.icon{width:192px;height:192px;object-fit:cover}.circle{border-radius:50%}.squircle{border-radius:24%}.splash{width:240px;height:480px;display:grid;place-items:center;background:${branding.splash.backgroundColor}}.splash img{width:${branding.splash.logoScale * 100}%}code{display:block;margin-top:1rem}</style>\n<h1>${appName}</h1><main><section class="card"><img class="icon squircle" src="${icon}" alt="Square app icon preview"><code>Apple / legacy Android</code></section><section class="card"><img class="icon circle" src="${icon}" alt="Circular Android icon preview"><code>Android circular mask</code></section><section class="card splash"><img src="${icon}" alt="Launch screen preview"></section></main><p>Fingerprint: <code>${manifest.fingerprint}</code></p>\n`;
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, html);

	return destination;
};
