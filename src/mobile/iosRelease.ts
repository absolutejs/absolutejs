import { createHash } from 'node:crypto';
import {
	access,
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';
import {
	detectAbsoluteMobileHost,
	type AbsoluteMobileHost
} from './emulatorDoctor';

export const ABSOLUTE_IOS_RELEASE_FORMAT = 1 as const;

export type AbsoluteIosReleaseMetadata = {
	appBuild: string;
	appId: string;
	artifact: 'App.ipa';
	buildNumber?: number;
	bytes: number;
	engine: 'capacitor';
	format: typeof ABSOLUTE_IOS_RELEASE_FORMAT;
	marketingVersion: string;
	platform: 'ios';
	releaseId: string;
	runtime: string;
	sha256: string;
	signed: boolean;
	type: 'ipa';
};

type MobileClientManifest = {
	appBuild: string;
	appId: string;
	runtime: string;
};
type CommandOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
};
type CommandResult = { exitCode: number; stderr: string; stdout: string };

export type BuildAbsoluteIosReleaseOptions = {
	allowUnsigned?: boolean;
	capture?: (command: string[], options?: CommandOptions) => CommandResult;
	config: NormalizedAbsoluteMobileConfig;
	developmentTeam?: string;
	host?: AbsoluteMobileHost;
	outputDirectory?: string;
	prepareBuildNumber?: (buildIdentity: string) => Promise<number>;
	projectRoot: string;
	run?: (command: string[], options?: CommandOptions) => Promise<number>;
	buildNumber?: number;
};

const developmentTeamArgument = (value: string | undefined) => {
	if (value === undefined) return undefined;
	const team = value.trim().toUpperCase();
	if (!/^[A-Z0-9]{10}$/u.test(team))
		throw new TypeError(
			'iOS development team must contain ten letters or digits.'
		);

	return `DEVELOPMENT_TEAM=${team}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const requireManifest = (value: unknown): MobileClientManifest => {
	if (
		!isRecord(value) ||
		typeof value.appBuild !== 'string' ||
		typeof value.appId !== 'string' ||
		typeof value.runtime !== 'string'
	) {
		throw new TypeError('Invalid embedded AbsoluteJS mobile manifest.');
	}

	return {
		appBuild: value.appBuild,
		appId: value.appId,
		runtime: value.runtime
	};
};

const pathExists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const defaultRun = async (command: string[], options: CommandOptions = {}) => {
	const process = Bun.spawn(command, {
		cwd: options.cwd,
		env: options.env,
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});

	return process.exited;
};

const defaultCapture = (command: string[], options: CommandOptions = {}) => {
	try {
		const result = Bun.spawnSync(command, {
			cwd: options.cwd,
			env: options.env,
			stderr: 'pipe',
			stdin: 'ignore',
			stdout: 'pipe'
		});

		return {
			exitCode: result.exitCode,
			stderr: result.stderr.toString(),
			stdout: result.stdout.toString()
		};
	} catch (error) {
		return {
			exitCode: 1,
			stderr: error instanceof Error ? error.message : String(error),
			stdout: ''
		};
	}
};

const ignoredFingerprintDirectories = new Set([
	'Pods',
	'DerivedData',
	'build',
	'xcuserdata'
]);

const fingerprintFiles = async (
	root: string,
	current = root,
	options: { includePublicBundle?: boolean } = {}
): Promise<string[]> => {
	const entries = await readdir(current, { withFileTypes: true });
	const nested = await Promise.all(
		entries
			.sort((left, right) => left.name.localeCompare(right.name))
			.map(async (entry) => {
				const path = join(current, entry.name);
				const projectRelative = relative(root, path).replaceAll(
					'\\',
					'/'
				);
				const ignored =
					entry.isDirectory() &&
					(ignoredFingerprintDirectories.has(entry.name) ||
						(projectRelative === 'App/App/public' &&
							options.includePublicBundle !== true));
				if (ignored) return [];
				if (entry.isDirectory())
					return fingerprintFiles(root, path, options);

				return entry.isFile() ? [path] : [];
			})
	);

	return nested.flat();
};

export const fingerprintAbsoluteIosNativeProject = async (
	nativeDirectory: string,
	options: { includePublicBundle?: boolean } = {}
) => {
	const hasher = createHash('sha256');
	const files = await fingerprintFiles(
		nativeDirectory,
		nativeDirectory,
		options
	);
	const contents = await Promise.all(files.map((file) => readFile(file)));
	files.forEach((file, index) => {
		hasher.update(relative(nativeDirectory, file).replaceAll('\\', '/'));
		hasher.update('\0');
		hasher.update(contents[index] ?? new Uint8Array());
		hasher.update('\0');
	});

	return hasher.digest('hex');
};

const safeOutputDirectory = (projectRoot: string, requested?: string) => {
	const root = resolve(projectRoot);
	const output = resolve(
		root,
		requested ?? '.absolutejs/mobile/releases/ios'
	);
	const projectRelative = relative(root, output);
	if (
		projectRelative === '..' ||
		projectRelative.startsWith(`..${sep}`) ||
		isAbsolute(projectRelative)
	) {
		throw new TypeError(
			'mobile build --outdir must remain inside the project.'
		);
	}

	return output;
};

const sha256File = async (path: string) =>
	createHash('sha256')
		.update(await readFile(path))
		.digest('hex');

const findByExtension = async (
	root: string,
	extension: string
): Promise<string | undefined> => {
	if (!(await pathExists(root))) return undefined;
	const entries = await readdir(root, { withFileTypes: true });
	const matches = await Promise.all(
		entries.map(async (entry) => {
			const path = join(root, entry.name);
			if (entry.isDirectory() && entry.name.endsWith(extension))
				return path;
			if (entry.isFile() && entry.name.endsWith(extension)) return path;

			return entry.isDirectory()
				? findByExtension(path, extension)
				: undefined;
		})
	);

	return matches.find((match) => match !== undefined);
};

const exportOptions = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>destination</key><string>export</string>
	<key>manageAppVersionAndBuildNumber</key><false/>
	<key>method</key><string>app-store-connect</string>
	<key>signingStyle</key><string>automatic</string>
	<key>stripSwiftSymbols</key><true/>
	<key>uploadSymbols</key><true/>
</dict></plist>
`;

const requireBuildNumber = (value: number | undefined) => {
	if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
		throw new TypeError('iOS build number must be a positive integer.');

	return value;
};

const installRelease = async (
	artifactPath: string,
	metadata: Omit<AbsoluteIosReleaseMetadata, 'artifact'>,
	outputRoot: string
) => {
	const releaseRoot = join(outputRoot, metadata.releaseId);
	const destination = join(releaseRoot, 'App.ipa');
	if (await pathExists(releaseRoot)) {
		const value: unknown = JSON.parse(
			await readFile(join(releaseRoot, 'release.json'), 'utf8')
		);
		if (
			!isRecord(value) ||
			value.artifact !== 'App.ipa' ||
			Object.entries(metadata).some(
				([key, expected]) => Reflect.get(value, key) !== expected
			)
		) {
			throw new TypeError(
				`Immutable iOS release ${metadata.releaseId} does not match its content.`
			);
		}
		const [bytes, sha256] = await Promise.all([
			stat(destination).then(({ size }) => size),
			sha256File(destination)
		]);
		if (bytes !== metadata.bytes || sha256 !== metadata.sha256)
			throw new TypeError(
				`Immutable iOS release ${metadata.releaseId} artifact is missing or modified.`
			);

		return {
			artifactPath: destination,
			metadata: {
				...metadata,
				artifact: 'App.ipa'
			} satisfies AbsoluteIosReleaseMetadata,
			releaseRoot
		};
	}
	await mkdir(dirname(releaseRoot), { recursive: true });
	const staging = await mkdtemp(join(dirname(releaseRoot), '.ios-stage-'));
	try {
		await copyFile(artifactPath, join(staging, 'App.ipa'));
		const complete = {
			...metadata,
			artifact: 'App.ipa'
		} satisfies AbsoluteIosReleaseMetadata;
		await writeFile(
			join(staging, 'release.json'),
			`${JSON.stringify(complete, null, '\t')}\n`,
			{ flag: 'wx' }
		);
		await rename(staging, releaseRoot);

		return { artifactPath: destination, metadata: complete, releaseRoot };
	} finally {
		await rm(staging, { force: true, recursive: true }).catch(
			() => undefined
		);
	}
};

export const buildAbsoluteIosRelease = async (
	options: BuildAbsoluteIosReleaseOptions
) => {
	if (options.buildNumber !== undefined && options.prepareBuildNumber)
		throw new TypeError(
			'iOS release buildNumber and prepareBuildNumber cannot be combined.'
		);
	if ((options.host ?? detectAbsoluteMobileHost()) !== 'macos')
		throw new TypeError('iOS release builds require macOS and Xcode.');
	const marketingVersion = options.config.iosVersion;
	if (!marketingVersion)
		throw new TypeError(
			'iOS release builds require mobile.ios.version in absolutejs.config.ts.'
		);
	const manifest = requireManifest(
		JSON.parse(
			await readFile(
				join(
					options.config.bundleDirectory,
					'absolute-mobile-manifest.json'
				),
				'utf8'
			)
		)
	);
	if (manifest.appId !== options.config.appId)
		throw new TypeError(
			'Embedded mobile manifest appId does not match mobile.appId.'
		);
	const nativeDirectory = join(options.config.nativeProjectDirectory, 'ios');
	let buildNumber = requireBuildNumber(options.buildNumber);
	if (options.prepareBuildNumber) {
		const nativeFingerprint =
			await fingerprintAbsoluteIosNativeProject(nativeDirectory);
		const buildIdentity = createHash('sha256')
			.update(
				`${manifest.appBuild}\0${nativeFingerprint}\0${marketingVersion}`
			)
			.digest('hex');
		buildNumber = requireBuildNumber(
			await options.prepareBuildNumber(buildIdentity)
		);
	}
	const stagingParent = resolve(options.projectRoot, '.absolutejs/mobile');
	await mkdir(stagingParent, { recursive: true });
	const staging = await mkdtemp(join(stagingParent, '.ios-build-'));
	const archivePath = join(staging, 'App.xcarchive');
	const exportPath = join(staging, 'export');
	const exportPlist = join(staging, 'ExportOptions.plist');
	await mkdir(exportPath, { recursive: true });
	await writeFile(exportPlist, exportOptions());
	const run = options.run ?? defaultRun;
	try {
		const developmentTeam = developmentTeamArgument(
			options.developmentTeam
		);
		const versionArguments = [
			`MARKETING_VERSION=${marketingVersion}`,
			...(developmentTeam ? [developmentTeam] : []),
			...(buildNumber === undefined
				? []
				: [`CURRENT_PROJECT_VERSION=${buildNumber}`])
		];
		const archiveExit = await run(
			[
				'xcodebuild',
				'-workspace',
				join(nativeDirectory, 'App', 'App.xcworkspace'),
				'-scheme',
				'App',
				'-configuration',
				'Release',
				'-destination',
				'generic/platform=iOS',
				'-archivePath',
				archivePath,
				...versionArguments,
				'archive'
			],
			{ cwd: nativeDirectory }
		);
		if (archiveExit !== 0)
			throw new TypeError('Xcode failed to archive the iOS app.');
		const archivedApp = await findByExtension(
			join(archivePath, 'Products', 'Applications'),
			'.app'
		);
		const capture = options.capture ?? defaultCapture;
		const signed = archivedApp
			? capture([
					'codesign',
					'--verify',
					'--deep',
					'--strict',
					archivedApp
				]).exitCode === 0
			: false;
		if (!signed && !options.allowUnsigned)
			throw new TypeError(
				'Xcode produced an unsigned iOS archive. Configure signing in the source-owned Xcode project, or pass --unsigned only for a non-publishable build.'
			);
		const exportExit = await run(
			[
				'xcodebuild',
				'-exportArchive',
				'-archivePath',
				archivePath,
				'-exportPath',
				exportPath,
				'-exportOptionsPlist',
				exportPlist
			],
			{ cwd: nativeDirectory }
		);
		if (exportExit !== 0)
			throw new TypeError('Xcode failed to export the App Store IPA.');
		const artifactPath = await findByExtension(exportPath, '.ipa');
		if (!artifactPath)
			throw new TypeError('Xcode did not produce an exported IPA.');
		const [bytes, sha256] = await Promise.all([
			stat(artifactPath).then(({ size }) => size),
			sha256File(artifactPath)
		]);
		const releaseId = `amobile_ios_${sha256}`;

		return await installRelease(
			artifactPath,
			{
				appBuild: manifest.appBuild,
				appId: manifest.appId,
				...(buildNumber === undefined ? {} : { buildNumber }),
				bytes,
				engine: 'capacitor',
				format: 1,
				marketingVersion,
				platform: 'ios',
				releaseId,
				runtime: manifest.runtime,
				sha256,
				signed,
				type: 'ipa'
			},
			safeOutputDirectory(options.projectRoot, options.outputDirectory)
		);
	} finally {
		await rm(staging, { force: true, recursive: true }).catch(
			() => undefined
		);
	}
};
