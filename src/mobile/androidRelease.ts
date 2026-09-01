import { createHash } from 'node:crypto';
import {
	access,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
	absoluteManagedAndroidSdkRoot,
	detectAbsoluteMobileHost,
	type AbsoluteMobileHost
} from './emulatorDoctor';
import {
	buildAbsoluteAndroidGradleArtifact,
	fingerprintAbsoluteAndroidNativeProject,
	type AbsoluteAndroidCommandOptions,
	type AbsoluteAndroidCommandResult
} from './androidEmulatorController';
import type { NormalizedAbsoluteMobileConfig } from './config';

export const ABSOLUTE_ANDROID_RELEASE_FORMAT = 1 as const;

export type AbsoluteAndroidReleaseMetadata = {
	appBuild: string;
	appId: string;
	artifact: string;
	bytes: number;
	engine: 'capacitor' | 'expo';
	format: typeof ABSOLUTE_ANDROID_RELEASE_FORMAT;
	platform: 'android';
	releaseId: string;
	runtime: string;
	sha256: string;
	signed: boolean;
	type: 'aab';
	versionCode?: number;
};

type MobileClientManifest = {
	appBuild: string;
	appId: string;
	runtime: string;
};

export type BuildAbsoluteAndroidReleaseOptions = {
	allowUnsigned?: boolean;
	androidRoot?: string;
	capture?: (
		command: string[],
		options?: AbsoluteAndroidCommandOptions
	) => AbsoluteAndroidCommandResult;
	config: NormalizedAbsoluteMobileConfig;
	env?: Record<string, string | undefined>;
	host?: AbsoluteMobileHost;
	jarsigner?: string | null;
	outputDirectory?: string;
	projectRoot: string;
	run?: (
		command: string[],
		options?: AbsoluteAndroidCommandOptions
	) => Promise<number>;
	prepareVersionCode?: (buildIdentity: string) => Promise<number>;
	signing?: {
		keyAlias: string;
		keyPasswordEnvironment: string;
		keystorePath: string;
		storePasswordEnvironment: string;
	};
	versionCode?: number;
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

const defaultCapture = (
	command: string[],
	options: AbsoluteAndroidCommandOptions = {}
) => {
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

const verifyAabSignature = (
	artifactPath: string,
	capture: NonNullable<BuildAbsoluteAndroidReleaseOptions['capture']>,
	jarsigner: string | null | undefined
) => {
	const executable =
		jarsigner === undefined ? Bun.which('jarsigner') : jarsigner;
	if (!executable) return null;
	const result = capture([
		executable,
		'-J-Duser.language=en',
		'-J-Duser.country=US',
		'-verify',
		artifactPath
	]);

	return result.exitCode === 0 && /jar verified/iu.test(result.stdout);
};

const signAab = (
	artifactPath: string,
	capture: NonNullable<BuildAbsoluteAndroidReleaseOptions['capture']>,
	jarsigner: string,
	signing: NonNullable<BuildAbsoluteAndroidReleaseOptions['signing']>
) => {
	const result = capture([
		jarsigner,
		'-keystore',
		signing.keystorePath,
		'-storepass:env',
		signing.storePasswordEnvironment,
		'-keypass:env',
		signing.keyPasswordEnvironment,
		artifactPath,
		signing.keyAlias
	]);
	if (result.exitCode !== 0)
		throw new TypeError(
			'jarsigner could not sign the Android App Bundle with the configured CI identity.'
		);
};

const sha256File = async (path: string) =>
	createHash('sha256')
		.update(await readFile(path))
		.digest('hex');

const fingerprintExpoAndroidProject = async (nativeDirectory: string) => {
	const root = await realpath(nativeDirectory);
	const files = await Array.fromAsync(
		new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true })
	);
	const records = await Promise.all(
		files
			.filter((path) => {
				const parts = path.replaceAll('\\', '/').split('/');

				return !parts.includes('.gradle') && !parts.includes('build');
			})
			.sort()
			.map(async (path) => {
				const contents = await readFile(join(root, path));

				return `${path.replaceAll('\\', '/')}\0${createHash('sha256').update(contents).digest('hex')}\0`;
			})
	);

	return createHash('sha256').update(records.join('')).digest('hex');
};

const safeOutputDirectory = (projectRoot: string, requested?: string) => {
	const root = resolve(projectRoot);
	const output = resolve(
		root,
		requested ?? '.absolutejs/mobile/releases/android'
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

const installRelease = async (
	artifactPath: string,
	metadata: Omit<AbsoluteAndroidReleaseMetadata, 'artifact'>,
	outputRoot: string
) => {
	const releaseRoot = join(outputRoot, metadata.releaseId);
	const artifactName = 'app-release.aab';
	const destination = join(releaseRoot, artifactName);
	if (await pathExists(releaseRoot)) {
		const existing = requireManifestIdentity(
			JSON.parse(
				await readFile(join(releaseRoot, 'release.json'), 'utf8')
			),
			metadata
		);
		const [installedBytes, installedSha256] = await Promise.all([
			stat(destination).then(({ size }) => size),
			sha256File(destination)
		]);
		if (
			installedBytes !== metadata.bytes ||
			installedSha256 !== metadata.sha256
		) {
			throw new TypeError(
				`Immutable Android release ${metadata.releaseId} artifact is missing or modified.`
			);
		}

		return { artifactPath: destination, metadata: existing, releaseRoot };
	}
	await mkdir(dirname(releaseRoot), { recursive: true });
	const staging = await mkdtemp(
		join(dirname(releaseRoot), '.android-stage-')
	);
	try {
		await copyFile(artifactPath, join(staging, artifactName));
		const complete = {
			...metadata,
			artifact: artifactName
		} satisfies AbsoluteAndroidReleaseMetadata;
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

const requireManifestIdentity = (
	value: unknown,
	expected: Omit<AbsoluteAndroidReleaseMetadata, 'artifact'>
) => {
	if (!isRecord(value)) {
		throw new TypeError('Existing Android release metadata is invalid.');
	}
	const { artifact } = value;
	if (
		artifact !== 'app-release.aab' ||
		Object.entries(expected).some(
			([key, expectedValue]) => Reflect.get(value, key) !== expectedValue
		)
	) {
		throw new TypeError(
			`Immutable Android release ${expected.releaseId} does not match its content.`
		);
	}

	return { ...expected, artifact } satisfies AbsoluteAndroidReleaseMetadata;
};

export const buildAbsoluteAndroidRelease = async (
	options: BuildAbsoluteAndroidReleaseOptions
) => {
	if (options.versionCode !== undefined && options.prepareVersionCode) {
		throw new TypeError(
			'Android release versionCode and prepareVersionCode cannot be combined.'
		);
	}
	if (
		options.versionCode !== undefined &&
		(!Number.isSafeInteger(options.versionCode) ||
			options.versionCode < 1 ||
			options.versionCode > 2_100_000_000)
	) {
		throw new TypeError(
			'Android versionCode must be an integer from 1 through 2100000000.'
		);
	}
	const projectRoot = resolve(options.projectRoot);
	const host = options.host ?? detectAbsoluteMobileHost();
	if (options.config.engine === 'expo' && host === 'wsl') {
		throw new TypeError(
			'Expo Android production builds from WSL are not available yet. Run the generated CI workflow on Linux or build from native Windows while the WSL projection is completed.'
		);
	}
	const androidRoot =
		options.androidRoot ??
		process.env.ANDROID_HOME ??
		process.env.ANDROID_SDK_ROOT ??
		absoluteManagedAndroidSdkRoot(host);
	const nativeDirectory = join(
		options.config.nativeProjectDirectory,
		'android'
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
	if (manifest.appId !== options.config.appId) {
		throw new TypeError(
			'Embedded mobile manifest appId does not match mobile.appId.'
		);
	}
	let { versionCode } = options;
	if (options.prepareVersionCode) {
		const nativeFingerprint =
			options.config.engine === 'expo'
				? await fingerprintExpoAndroidProject(nativeDirectory)
				: await fingerprintAbsoluteAndroidNativeProject({
						nativeDirectory
					});
		const buildIdentity = createHash('sha256')
			.update(`${manifest.appBuild}\0${nativeFingerprint}`)
			.digest('hex');
		versionCode = await options.prepareVersionCode(buildIdentity);
	}
	if (
		versionCode !== undefined &&
		(!Number.isSafeInteger(versionCode) ||
			versionCode < 1 ||
			versionCode > 2_100_000_000)
	) {
		throw new TypeError(
			'Android versionCode must be an integer from 1 through 2100000000.'
		);
	}
	const { artifactPath } = await buildAbsoluteAndroidGradleArtifact({
		capture: options.capture,
		env: options.env,
		gradleArguments:
			versionCode === undefined
				? []
				: [`-Pandroid.injected.version.code=${versionCode}`],
		project: {
			androidRoot,
			config: options.config,
			host,
			nativeDirectory,
			projectRoot
		},
		run: options.run,
		task: 'bundleRelease'
	});
	if (!(await pathExists(artifactPath))) {
		throw new TypeError(
			`Android Gradle did not produce the expected App Bundle: ${artifactPath}`
		);
	}
	const capture = options.capture ?? defaultCapture;
	const jarsigner =
		options.jarsigner === undefined
			? Bun.which('jarsigner')
			: options.jarsigner;
	let signed = verifyAabSignature(artifactPath, capture, jarsigner);
	if (signed === false && options.signing) {
		if (!jarsigner)
			throw new TypeError(
				'Could not sign the Android App Bundle because jarsigner is unavailable.'
			);
		signAab(artifactPath, capture, jarsigner, options.signing);
		signed = verifyAabSignature(artifactPath, capture, jarsigner);
		if (!signed)
			throw new TypeError(
				'Android App Bundle signature verification failed after CI signing.'
			);
	}
	if (signed === null && !options.allowUnsigned) {
		throw new TypeError(
			'Could not verify the Android App Bundle signature because jarsigner is unavailable. Install a JDK, or use --unsigned only for a non-publishable build.'
		);
	}
	if (!signed && !options.allowUnsigned) {
		throw new TypeError(
			'Android Gradle produced an unsigned App Bundle. Configure the release signingConfig in the source-owned Android project (prefer external Gradle properties), or pass --unsigned only for a non-publishable build.'
		);
	}
	const [bytes, sha256] = await Promise.all([
		stat(artifactPath).then(({ size }) => size),
		sha256File(artifactPath)
	]);
	const releaseId = `amobile_android_${sha256}`;
	const metadata = {
		appBuild: manifest.appBuild,
		appId: manifest.appId,
		bytes,
		engine: options.config.engine,
		format: ABSOLUTE_ANDROID_RELEASE_FORMAT,
		platform: 'android',
		releaseId,
		runtime: manifest.runtime,
		sha256,
		signed: signed === true,
		type: 'aab',
		...(versionCode === undefined ? {} : { versionCode })
	} satisfies Omit<AbsoluteAndroidReleaseMetadata, 'artifact'>;

	return installRelease(
		artifactPath,
		metadata,
		safeOutputDirectory(projectRoot, options.outputDirectory)
	);
};
